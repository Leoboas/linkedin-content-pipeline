export type VisualFormat = "editorial-cover" | "architecture-infographic" | "technical-concept" | "carousel-slide";

export const CREATIVE_DIRECTION_PROMPT = [
  "Direção criativa obrigatória para LinkedIn Tech & Engineering:",
  "Crie uma peça editorial premium, específica para o problema técnico do post, e não uma ilustração corporativa genérica.",
  "Priorize hierarquia visual clara, espaço negativo, contraste controlado, profundidade e acabamento de comunicação de uma empresa global de tecnologia.",
  "Não invente serviços, métricas, nomes de componentes, funcionalidades ou status de produção. Represente somente a arquitetura e as evidências fornecidas.",
  "A narrativa deve seguir problema real, desafio técnico, decisão arquitetural, solução e aprendizado ou resultado.",
  "Para posts individuais, prefira composição vertical 4:5. Use carrossel apenas quando várias etapas ou relações não couberem em uma única imagem.",
  "Evite nuvens, servidores, robôs, computadores aleatórios, banco de imagens e elementos tecnológicos sem relação com o tema.",
].join(" ");

export function visualFormatPrompt(format: VisualFormat): string {
  const prompts: Record<VisualFormat, string> = {
    "editorial-cover": "Formato: capa editorial vertical 4:5. Título curto, uma mensagem visual central, poucos elementos técnicos e leitura imediata no celular.",
    "architecture-infographic": "Formato: infográfico de arquitetura. Mostre somente componentes e relações presentes no contexto, com fluxo legível e poucos rótulos.",
    "technical-concept": "Formato: visual conceitual técnico. Represente resiliência, falha, escala, observabilidade ou processamento distribuído com uma metáfora visual precisa.",
    "carousel-slide": "Formato: lâmina de carrossel. Uma ideia por lâmina, no máximo três pontos visuais, tipografia programática legível e composição sem excesso de informação.",
  };
  return prompts[format];
}

export function visualFormatForPost(formatType?: string, pillar?: string): VisualFormat {
  if (formatType === "CAROUSEL_PDF") return "carousel-slide";
  if (pillar === "BOFU") return "architecture-infographic";
  if (pillar === "MOFU") return "technical-concept";
  return "editorial-cover";
}
