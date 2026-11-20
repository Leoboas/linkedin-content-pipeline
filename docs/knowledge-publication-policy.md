# Política de evidências publicáveis

- A afirmação publicável vem do `ProfessionalFact`, `ProfessionalExperience` ou `PortfolioProject` e precisa ter autorização pública, visibilidade `PUBLIC_SAFE`, evidência aceita e status de implementação compatível. Itens `PLANNED`, `UNKNOWN`, internos ou pendentes não são promovidos a fatos realizados.
- A classificação interna da fonte não torna automaticamente privado um fato separado que foi explicitamente autorizado como público. O snapshot preserva a visibilidade da afirmação (`visibilitySnapshot`) e da fonte (`sourceVisibilitySnapshot`) em campos distintos, mais o hash e o ID da fonte.
- Conteúdo integral de `KnowledgeDocument` não é copiado para briefs. Um trecho só pode ser materializado no campo `authorizedExcerpt` depois de uma autorização explícita; `ProfessionalFactSource.excerptPublicAllowed` começa como `false`.
- O snapshot de evidência armazena a afirmação publicável usada naquela geração e sua proveniência. Uma correção posterior na base não reescreve silenciosamente o registro criativo histórico.
- Associações textuais legadas em `Post.associatedProject` não são convertidas automaticamente. O reconciliador produz sugestões para confirmação humana; apenas um arquivo de mapeamento confirmado pode criar `PostProject` no banco Development.
