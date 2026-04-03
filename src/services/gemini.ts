import { GoogleGenAI, Content } from "@google/genai";

const SYSTEM_INSTRUCTION = `
Vous êtes un expert juridique spécialisé exclusivement dans le Code de Justice Administrative (CJA) français.
Votre mission est de répondre aux questions juridiques en vous basant sur le CJA, enrichi par la jurisprudence et la doctrine fournies.

STRUCTURE DE RÉPONSE OBLIGATOIRE :
1. **CADRE LÉGAL** : Citez systématiquement les articles du CJA (ex: Art. L. 521-1).
2. **JURISPRUDENCE** : Illustrez par les arrêts pertinents (ex: CE, Ass., 1950, Dame Lamotte).
3. **DOCTRINE & ANALYSE** : Apportez les éléments de doctrine et de commentaire disponibles dans la base.

Règles strictes :
- Si une information n'est pas dans le CJA ou dans la base fournie, indiquez-le.
- Utilisez un ton professionnel, précis et structuré.
- Distinguez clairement la partie législative (L) de la partie réglementaire (R).
`;

const TEACHING_INSTRUCTION = `
Vous êtes un Professeur d'Université en Droit Administratif. Votre objectif est la pédagogie et la transmission du savoir à des étudiants.
Tout en restant rigoureux sur le plan juridique (CJA, jurisprudence), vous devez :
1. **VULGARISATION** : Expliquer les concepts complexes avec des termes accessibles.
2. **MÉTHODOLOGIE** : Rappeler les étapes du raisonnement juridique (majeure, mineure, conclusion).
3. **EXEMPLES CONCRETS** : Utiliser des analogies ou des cas pratiques pour illustrer la règle.
4. **QUESTIONS DE RÉFLEXION** : Terminer par une question pour stimuler la réflexion critique de l'étudiant.

Gardez la structure (Cadre légal, Jurisprudence, Doctrine) mais avec un ton professoral, bienveillant et didactique.
`;

export async function askLegalQuestion(
  question: string, 
  history: Content[] = [], 
  isTeachingMode: boolean = false,
  knowledgeBase?: string,
  link?: string
) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (!apiKey || apiKey === 'undefined' || apiKey === '') {
    console.error("ERREUR LEXADMIN: Clé API Gemini manquante. Vérifiez votre fichier .env (VITE_GEMINI_API_KEY) et relancez 'npm run build' puis 'firebase deploy'.");
    throw new Error("Clé API manquante");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  const modelName = "gemini-3.1-pro-preview";
  const baseInstruction = isTeachingMode ? TEACHING_INSTRUCTION : SYSTEM_INSTRUCTION;

  const contextInstruction = knowledgeBase 
    ? `\n\nBASE DE CONNAISSANCES COMPLÉMENTAIRE (Jurisprudence et Doctrine) :\n${knowledgeBase}\n\nUtilisez cette base pour illustrer vos réponses avec la jurisprudence et la doctrine pertinentes.`
    : "";

  const tools: any[] = [{ googleSearch: {} }];

  try {
    const chat = ai.chats.create({
      model: modelName,
      config: {
        systemInstruction: baseInstruction + contextInstruction + (link ? `\n\nCONTEXTE URL : Veuillez vous référer au contenu de ce lien pour répondre : ${link}` : ""),
        tools: tools,
      },
      history: history
    });

    const response = await chat.sendMessage({ message: question });

    return {
      text: response.text || "Désolé, je n'ai pas pu générer de réponse.",
      sources: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => chunk.web?.uri).filter(Boolean) as string[] || []
    };
  } catch (error) {
    console.error("Erreur Gemini:", error);
    throw error;
  }
}
