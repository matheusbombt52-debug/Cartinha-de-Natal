# Instalação da Cakto

1. Abra o SQL Editor do Supabase e execute o conteúdo de `cakto.sql`. A tabela guarda a referência entre a cartinha e a cobrança.
2. Extraia o ZIP e substitua `index.html` e `src/worker.js` no GitHub. Aguarde o deploy do Cloudflare. Confira em Production as variáveis `CAKTO_CLIENT_ID`, `CAKTO_CLIENT_SECRET` e `CAKTO_OFFER_ID` (427xxfa).
3. Na Cakto, crie um webhook para o produto Cartinha de Natal e o evento `purchase_approved`. Use https://cartinha-de-natal.pv2.workers.dev/api/cakto/webhook como destino.
4. No Cloudflare, adicione o segredo gerado pelo webhook como `CAKTO_WEBHOOK_SECRET` em Production e faça o deploy. A presença desse segredo habilita o checkout real. O Worker exige a assinatura da Cakto.
5. Teste o webhook no painel e confira a resposta do endpoint. Depois valide o Pix e o cartão com compras controladas. A Cakto documenta a homologação de cobranças em produção, que movimenta dinheiro de verdade.

O checkout usa CPF, pagamento à vista no cartão e confirmação por webhook. Cada cartinha aceita uma tentativa de cobrança. Se houver uma falha de comunicação, confira a transação no painel antes de iniciar outra cartinha. Para cartas com foto ou áudio, mantenha a tela aberta até terminar a liberação e o envio da mídia.

Referências: https://docs.cakto.com.br/api-reference/payments/create-pix, https://docs.cakto.com.br/api-reference/payments/create-card, https://docs.cakto.com.br/conceitos/webhooks e https://docs.cakto.com.br/sdk/visao-geral.
