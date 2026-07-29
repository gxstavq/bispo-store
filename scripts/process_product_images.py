from __future__ import annotations

import csv
import hashlib
import io
import json
import random
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Fotos Bispo Store"
OUTPUT = ROOT / "public" / "produtos" / "otimizados"
THUMBS = OUTPUT / "thumbs"
REPORTS = ROOT / "reports"
PRODUCTS_JSON = ROOT / "data" / "provisional-products.generated.json"
VALID_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".avif"
}
SEED = int.from_bytes(hashlib.sha256(b"bispo-store").digest()[:8], "big")


def human_bytes(value: int) -> str:
    if value < 1024:
        return f"{value} B"
    if value < 1024 * 1024:
        return f"{value / 1024:.1f} KB"
    return f"{value / 1024 / 1024:.2f} MB"


def normalize_image(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if getattr(image, "is_animated", False):
        image.seek(0)
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def resize_down(image: Image.Image, max_side: int) -> Image.Image:
    width, height = image.size
    if max(width, height) <= max_side:
        return image.copy()
    ratio = max_side / max(width, height)
    size = (max(1, round(width * ratio)), max(1, round(height * ratio)))
    return image.resize(size, Image.Resampling.LANCZOS)


def encode_webp(image: Image.Image, target_kb: int = 300, ceiling_kb: int = 450) -> tuple[bytes, int]:
    best: tuple[bytes, int] | None = None
    for quality in (92, 88, 84, 80, 76, 72, 68, 64):
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=quality, method=6, optimize=True)
        payload = buffer.getvalue()
        best = (payload, quality)
        if len(payload) <= target_kb * 1024:
            return payload, quality

    assert best is not None
    working = image
    payload, quality = best
    while len(payload) > ceiling_kb * 1024 and max(working.size) > 800:
        working = resize_down(working, max(800, round(max(working.size) * 0.9)))
        buffer = io.BytesIO()
        working.save(buffer, format="WEBP", quality=64, method=6, optimize=True)
        payload = buffer.getvalue()
    return payload, quality


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    THUMBS.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    PRODUCTS_JSON.parent.mkdir(parents=True, exist_ok=True)

    found = sorted(
        [path for path in SOURCE.rglob("*") if path.is_file()],
        key=lambda path: str(path.relative_to(SOURCE)).casefold(),
    )
    candidates = [path for path in found if path.suffix.casefold() in VALID_EXTENSIONS]
    ignored: list[dict[str, str]] = [
        {
            "arquivo": str(path.relative_to(SOURCE)),
            "motivo": f"extensão não suportada: {path.suffix or '(sem extensão)'}",
        }
        for path in found
        if path.suffix.casefold() not in VALID_EXTENSIONS
    ]
    valid: list[dict[str, Any]] = []

    for path in candidates:
        try:
            original_bytes = path.stat().st_size
            with Image.open(path) as probe:
                probe.verify()
            with Image.open(path) as opened:
                oriented = normalize_image(opened)
                valid.append(
                    {
                        "path": path,
                        "relative": str(path.relative_to(SOURCE)),
                        "original_bytes": original_bytes,
                        "original_width": opened.width,
                        "original_height": opened.height,
                        "image": oriented,
                    }
                )
        except (UnidentifiedImageError, OSError, ValueError) as error:
            ignored.append(
                {
                    "arquivo": str(path.relative_to(SOURCE)),
                    "motivo": f"arquivo inválido ou corrompido: {error}",
                }
            )

    random.Random(SEED).shuffle(valid)
    product_count = len(valid) // 2
    groups: list[list[dict[str, Any]]] = [
        valid[index * 2 : index * 2 + 2] for index in range(product_count)
    ]
    remainder = valid[product_count * 2 :]
    for index, item in enumerate(remainder):
        groups[index % len(groups)].append(item)

    rows: list[dict[str, Any]] = []
    products: list[dict[str, Any]] = []

    for product_index, group in enumerate(groups, start=1):
        product_images: list[str] = []
        product_thumbs: list[str] = []

        for image_index, record in enumerate(group, start=1):
            basename = f"produto-{product_index:03d}-{image_index:02d}.webp"
            target = OUTPUT / basename
            thumb_target = THUMBS / basename

            optimized = resize_down(record["image"], 1400)
            optimized_bytes, quality = encode_webp(optimized)
            target.write_bytes(optimized_bytes)

            thumb = resize_down(record["image"], 600)
            thumb_buffer = io.BytesIO()
            thumb.save(thumb_buffer, format="WEBP", quality=78, method=6, optimize=True)
            thumb_bytes = thumb_buffer.getvalue()
            thumb_target.write_bytes(thumb_bytes)

            public_path = f"/produtos/otimizados/{basename}"
            public_thumb = f"/produtos/otimizados/thumbs/{basename}"
            product_images.append(public_path)
            product_thumbs.append(public_thumb)
            rows.append(
                {
                    "produto": f"Tênis {product_index:03d}",
                    "codigo": f"BSP-PROV-{product_index:03d}",
                    "ordem": image_index,
                    "arquivo_original": record["relative"],
                    "dimensoes_originais": f"{record['original_width']}x{record['original_height']}",
                    "tamanho_original_bytes": record["original_bytes"],
                    "tamanho_original": human_bytes(record["original_bytes"]),
                    "arquivo_otimizado": public_path,
                    "dimensoes_otimizadas": f"{optimized.width}x{optimized.height}",
                    "tamanho_otimizado_bytes": len(optimized_bytes),
                    "tamanho_otimizado": human_bytes(len(optimized_bytes)),
                    "qualidade_webp": quality,
                    "miniatura": public_thumb,
                    "dimensoes_miniatura": f"{thumb.width}x{thumb.height}",
                    "tamanho_miniatura_bytes": len(thumb_bytes),
                    "tamanho_miniatura": human_bytes(len(thumb_bytes)),
                }
            )

        products.append(
            {
                "id": f"prov-{product_index:03d}",
                "name": f"Tênis {product_index:03d}",
                "slug": f"tenis-{product_index:03d}",
                "code": f"BSP-PROV-{product_index:03d}",
                "category": "tenis",
                "description": "Produto provisório aguardando cadastro",
                "price": round(279.9 + ((product_index - 1) % 5) * 20, 2),
                "images": product_images,
                "thumbnails": product_thumbs,
                "coverImage": product_images[0],
                "sizes": ["38", "39", "40", "41", "42"],
                "colors": ["A definir"],
                "stock": 5 + ((product_index * 7) % 18),
                "featured": product_index <= 8,
                "isNew": product_index <= 16,
                "active": True,
                "status": "active",
                "needsReview": True,
                "demo": True,
                "imageType": "photo",
                "visual": {
                    "accent": "#ef2b35",
                    "secondary": "#f7f7f4",
                    "type": "shoe",
                },
            }
        )

    PRODUCTS_JSON.write_text(
        json.dumps(products, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (REPORTS / "image-optimization-report.json").write_text(
        json.dumps(
            {
                "seed": "bispo-store",
                "encontradas": len(found),
                "candidatas": len(candidates),
                "processadas": len(rows),
                "ignoradas": len(ignored),
                "produtos_provisorios": len(products),
                "distribuicao": {
                    product["name"]: len(product["images"]) for product in products
                },
                "arquivos_ignorados": ignored,
                "imagens": rows,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    with (REPORTS / "image-optimization-report.csv").open(
        "w", newline="", encoding="utf-8-sig"
    ) as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    (REPORTS / "ignored-images.json").write_text(
        json.dumps(ignored, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "encontradas": len(found),
                "processadas": len(rows),
                "ignoradas": len(ignored),
                "produtos": len(products),
                "por_produto": sorted({len(group) for group in groups}),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
