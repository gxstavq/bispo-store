const context = process.env.CONTEXT ?? "";

if (context === "production") {
  console.log("Build de produção bloqueado: somente Deploy Previews estão autorizados.");
  process.exit(0);
}

process.exit(1);
