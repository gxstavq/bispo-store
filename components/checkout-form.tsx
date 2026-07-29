"use client";

import { ArrowRight, LockKeyhole, MessageCircle, ShoppingBag, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { formatCurrency, whatsappUrl } from "@/lib/format";
import {
  createOrder,
  createPaymentCheckout,
  CustomerAuthenticationRequiredError,
} from "@/services/order-service";
import type { CheckoutData, Product, ShippingQuote } from "@/types/commerce";
import { useStore } from "./store-provider";

const initialData: CheckoutData = {
  fullName: "", whatsapp: "", email: "", cep: "", street: "", number: "", complement: "",
  district: "", city: "", state: "SP", reference: "", notes: "", deliveryChoice: "local_delivery_review",
};

export function CheckoutForm({ products }: { products: Product[] }) {
  const router = useRouter();
  const { items, clearCart } = useStore();
  const [data, setData] = useState<CheckoutData>(initialData);
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [quotedCartKey, setQuotedCartKey] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState("");
  const [error, setError] = useState("");
  const cartKey = JSON.stringify(items.map(({ productId, size, color, quantity }) => ({
    productId, size, color, quantity,
  })));
  const selectedQuote = quotes.find((quote) => quote.id === data.selectedShippingQuoteId);
  const quoteIsCurrent = quotedCartKey === `${data.cep.replace(/\D/g, "")}:${cartKey}`;
  const subtotal = useMemo(() => items.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return sum + (product?.promotionalPrice ?? product?.price ?? 0) * item.quantity;
  }, 0), [items, products]);

  const update = (field: keyof CheckoutData, value: string) => {
    setData((current) => {
      if (field === "cep" || field === "deliveryChoice") {
        return { ...current, [field]: value, selectedShippingQuoteId: undefined };
      }
      return { ...current, [field]: value };
    });
  };

  const calculateShipping = async () => {
    setQuoting(true);
    setError("");
    try {
      const response = await fetch("/api/shipping/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postalCode: data.cep, items }),
      });
      const result = await response.json() as {
        quotes?: ShippingQuote[];
        error?: string;
        loginRequired?: boolean;
      };
      if (response.status === 401 && result.loginRequired) {
        router.push("/entrar?next=/checkout");
        return;
      }
      if (!response.ok || !result.quotes) throw new Error(result.error ?? "Não foi possível calcular o frete.");
      setQuotes(result.quotes);
      setQuotedCartKey(`${data.cep.replace(/\D/g, "")}:${cartKey}`);
      setData((current) => ({ ...current, selectedShippingQuoteId: undefined }));
    } catch (caught) {
      setQuotes([]);
      setError(caught instanceof Error ? caught.message : "Não foi possível calcular o frete.");
    } finally {
      setQuoting(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      data.deliveryChoice === "shipping_quote"
      && (!selectedQuote || !quoteIsCurrent)
    ) {
      setError("Calcule e selecione novamente um frete válido para este carrinho.");
      return;
    }
    setSubmitting(true);
    setError("");
    let orderId = createdOrderId;
    try {
      orderId = createdOrderId || (await createOrder(items, data)).id;
      if (!createdOrderId) setCreatedOrderId(orderId);
      if (data.deliveryChoice === "shipping_quote") {
        const payment = await createPaymentCheckout(orderId);
        clearCart();
        window.location.assign(payment.paymentUrl);
        return;
      }
      clearCart();
      router.push(`/pedido-recebido?pedido=${orderId}`);
    } catch (caught) {
      if (caught instanceof CustomerAuthenticationRequiredError) {
        router.push("/entrar?next=/checkout");
        return;
      }
      if (orderId) {
        clearCart();
        router.push(`/pedido-recebido?pedido=${orderId}&pagamento=pendente`);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o pedido.");
      setSubmitting(false);
    }
  };

  if (!items.length) {
    return (
      <div className="empty-cart">
        <ShoppingBag size={40} />
        <h2>Nenhum produto para finalizar.</h2>
        <p>Adicione produtos ao carrinho antes de acessar o checkout.</p>
        <button className="button button--dark" onClick={() => router.push("/catalogo")}>Ir ao catálogo</button>
      </div>
    );
  }

  return (
    <form className="checkout-layout" onSubmit={submit}>
      <div className="checkout-form">
        <div className="demo-banner"><LockKeyhole /><div><strong>Ambiente Sandbox — nenhum pagamento real será processado.</strong><span>O pagamento acontece somente na página segura de testes do PagBank; a Bispo Store não coleta dados de cartão.</span></div></div>
        <section className="form-section">
          <div className="form-section__title"><span>01</span><div><h2>Contato</h2><p>Usaremos seus dados apenas para este pedido de teste.</p></div></div>
          <div className="form-grid">
            <label className="span-2">Nome completo<input required value={data.fullName} onChange={(e) => update("fullName", e.target.value)} /></label>
            <label>WhatsApp<input required value={data.whatsapp} onChange={(e) => update("whatsapp", e.target.value)} placeholder="(11) 99999-9999" /></label>
            <label>E-mail<input required type="email" value={data.email} onChange={(e) => update("email", e.target.value)} /></label>
          </div>
        </section>
        <section className="form-section">
          <div className="form-section__title"><span>02</span><div><h2>Entrega</h2><p>Endereço limitado ao estado de São Paulo.</p></div></div>
          <div className="form-grid">
            <label>CEP<input required value={data.cep} onChange={(e) => update("cep", e.target.value)} placeholder="00000-000" /></label>
            <label>Estado<select value="SP" disabled><option>São Paulo (SP)</option></select></label>
            <label className="span-2">Rua<input required value={data.street} onChange={(e) => update("street", e.target.value)} /></label>
            <label>Número<input required value={data.number} onChange={(e) => update("number", e.target.value)} /></label>
            <label>Complemento<input value={data.complement} onChange={(e) => update("complement", e.target.value)} /></label>
            <label>Bairro<input required value={data.district} onChange={(e) => update("district", e.target.value)} /></label>
            <label>Cidade<input required value={data.city} onChange={(e) => update("city", e.target.value)} /></label>
            <label className="span-2">Ponto de referência<input value={data.reference} onChange={(e) => update("reference", e.target.value)} /></label>
          </div>
        </section>
        <section className="form-section">
          <div className="form-section__title"><span>03</span><div><h2>Como deseja receber?</h2><p>O frete é sempre confirmado no servidor.</p></div></div>
          <div className="delivery-choice-grid">
            <label className={data.deliveryChoice === "local_delivery_review" ? "delivery-choice is-selected" : "delivery-choice"}>
              <input type="radio" name="deliveryChoice" checked={data.deliveryChoice === "local_delivery_review"} onChange={() => update("deliveryChoice", "local_delivery_review")} />
              <span><strong>Solicitar análise de entrega local grátis em até 5 km</strong><small>A gratuidade não é automática. A loja analisará o endereço antes de liberar o pagamento.</small></span>
            </label>
            <label className={data.deliveryChoice === "shipping_quote" ? "delivery-choice is-selected" : "delivery-choice"}>
              <input type="radio" name="deliveryChoice" checked={data.deliveryChoice === "shipping_quote"} onChange={() => update("deliveryChoice", "shipping_quote")} />
              <span><strong>Calcular frete para meu endereço</strong><small>Opções e valores reais retornados pelo Melhor Envio Sandbox.</small></span>
            </label>
          </div>
          {data.deliveryChoice === "local_delivery_review" ? (
            <div className="local-delivery-warning"><Truck /><div><strong>Entrega grátis sujeita à confirmação da Bispo Store.</strong><p>O pedido será criado sem frete e sem pagamento. Após a análise, a loja libera o link Sandbox.</p><a href={whatsappUrl("Olá! Tenho uma dúvida sobre a análise de entrega local grátis.")} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Tirar dúvida pelo WhatsApp</a></div></div>
          ) : (
            <div className="shipping-quotes">
              <button className="button button--dark" type="button" disabled={quoting || data.cep.replace(/\D/g, "").length !== 8} onClick={() => void calculateShipping()}>
                <Truck size={17} /> {quoting ? "Consultando Melhor Envio..." : "Calcular frete no Sandbox"}
              </button>
              {quoteIsCurrent && quotes.map((quote) => (
                <label className={data.selectedShippingQuoteId === quote.id ? "shipping-quote is-selected" : "shipping-quote"} key={quote.id}>
                  <input
                    type="radio"
                    name="shippingQuote"
                    checked={data.selectedShippingQuoteId === quote.id}
                    onChange={() => setData((current) => ({ ...current, selectedShippingQuoteId: quote.id }))}
                  />
                  <span><strong>{quote.carrier} · {quote.service}</strong><small>Prazo estimado: {quote.deliveryDays} dia(s)</small></span>
                  <b>{formatCurrency(quote.amount)}</b>
                </label>
              ))}
              {!!quotes.length && !quoteIsCurrent && <p className="field-hint">O CEP ou o carrinho mudou. Calcule o frete novamente.</p>}
            </div>
          )}
        </section>
        <section className="form-section">
          <div className="form-section__title"><span>04</span><div><h2>Observações</h2><p>Inclua preferências ou informações úteis.</p></div></div>
          <label>Observações do pedido<textarea rows={4} value={data.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Mensagem opcional..." /></label>
        </section>
        {error && <div className="admin-feedback" role="alert">{error}</div>}
      </div>
      <aside className="checkout-summary">
        <span className="eyebrow eyebrow--red">SEU PEDIDO</span>
        {items.map((item) => {
          const product = products.find((candidate) => candidate.id === item.productId);
          if (!product) return null;
          return <div className="checkout-product" key={`${item.productId}-${item.size}-${item.color}`}><span>{item.quantity}×</span><div><strong>{product.name}</strong><small>{item.size} · {item.color}</small></div><b>{formatCurrency((product.promotionalPrice ?? product.price) * item.quantity)}</b></div>;
        })}
        <div className="shipping-alert"><Truck /><p><strong>{data.deliveryChoice === "local_delivery_review" ? "Análise local pendente." : selectedQuote ? `${selectedQuote.carrier} · ${selectedQuote.service}` : "Selecione o frete."}</strong> {data.deliveryChoice === "local_delivery_review" ? "Nenhuma cobrança será criada agora." : selectedQuote ? formatCurrency(selectedQuote.amount) : "Cotação necessária."}</p></div>
        <div className="summary-total"><span>Total {selectedQuote ? "com frete" : "sem frete"}</span><strong>{formatCurrency(subtotal + (selectedQuote?.amount ?? 0))}</strong></div>
        <button className="button button--red button--full" disabled={submitting || (data.deliveryChoice === "shipping_quote" && !selectedQuote)}>{submitting ? "Processando..." : <>{data.deliveryChoice === "local_delivery_review" ? "Solicitar análise local" : "Ir ao PagBank Sandbox"} <ArrowRight size={18} /></>}</button>
        <small className="checkout-legal">Produtos, preços, frete e estoque serão recalculados no servidor. Para frete normal, você será redirecionado ao Checkout PagBank Sandbox.</small>
      </aside>
    </form>
  );
}
