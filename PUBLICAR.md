# Publicação da Cartinha de Natal

## Atualização do repositório

Extraia o ZIP. Envie index.html, config.js, favicon-cartinha.png, wrangler.jsonc e .assetsignore para a raiz. Envie as imagens para img/ e src/worker.js para src/. O arquivo .assetsignore pode ficar oculto após extrair, então confira se está no repositório. Os SQLs são para uma instalação nova. Em produção com as tabelas já configuradas, mantenha o banco atual.

## Antes de divulgar

- Use o mesmo Worker de produção e as variáveis que já estão no painel.
- A oferta na Cakto precisa retornar R$ 10,99 no Pix. O Worker só exibe QR com esse valor.
- Confirme a entrega por e-mail após um Pix aprovado.
- O Pixel 1096325106726508 está configurado para o endereço cartinha-de-natal.pv2.workers.dev. Se mudar de domínio, atualize a configuração do Pixel no HTML.
- No Gerenciador de Eventos, confirme PageView ao abrir o site e InitiateCheckout ao abrir a tela de pagamento. Purchase depende da Cakto e só deve aparecer após Pix aprovado. Mantenha desligada a opção de disparar Purchase ao gerar Pix.
