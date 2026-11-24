import { GoogleGenerativeAI } from '@google/generative-ai';
import { getWebsiteConfig, decodeKey } from './websites-config';

// Built-in pool of Gemini API keys with multi-key rotation and failure bypass
const defaultApiKey = decodeKey('QUl6YVN5QWJRZUtnc3FEcGJRTUpDOXhGTnFXUm1DaTc3VmRaOVRr', 'GEMINI_API_KEY');
const backupApiKey = decodeKey('QVEuQWI4Uk42TE03eXVxZFpmaUFLVGlUTEY3VlFNMGd6MjR5YXgzb3JacC14NWJOSGtVVHc=', 'GEMINI_BACKUP_API_KEY');

// User-provided Gemini Free API keys pool
const userProvidedGeminiKeys: string[] = [
  decodeKey('QVEuQWI4Uk42S1RIWG5jakc1dlB2WmxVVldZWTJJd1hiUWc0ZU8yQVY5ZzRkWFBqMFNuOGc=', 'GEMINI_KEY_1'),
  decodeKey('QVEuQWI4Uk42TGtYX0g3RkxmSHZIaVpKLTJmWEVDWEZPbFJEVGM1aHJLbHA0V2l1UDF0Q1E=', 'GEMINI_KEY_2'),
  decodeKey('QVEuQWI4Uk42TFpPekVydzhoclA5a1lCeFZZZ1llNklvSFRuMzZIVk10ZzA5SmdGTHk4Q3c=', 'GEMINI_KEY_3')
];

// In-memory blacklist for exhausted/rate-limited keys with cooldown (60s)
const exhaustedKeysCooldown = new Map<string, number>();

export function getGeminiKeyPool(siteKey?: string): string[] {
  const envKeys: string[] = [];
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.GEMINI_API_KEYS) {
      envKeys.push(...process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean));
    }
    ['GEMINI_API_KEY', 'GEMINI_BACKUP_API_KEY', 'GEMINI_KEY_3', 'GEMINI_KEY_4', 'GEMINI_KEY_5'].forEach(envName => {
      if (process.env[envName]) {
        envKeys.push(process.env[envName]!.trim());
      }
    });
  }

  const allKeys = [
    siteKey,
    ...userProvidedGeminiKeys,
    ...envKeys,
    defaultApiKey,
    backupApiKey
  ].filter((k, idx, arr): k is string => Boolean(k) && arr.indexOf(k) === idx);

  const now = Date.now();
  const activeKeys = allKeys.filter(k => {
    const cooldownUntil = exhaustedKeysCooldown.get(k) || 0;
    return now > cooldownUntil;
  });

  return activeKeys.length > 0 ? activeKeys : allKeys;
}

export const SERVICES_PATTERNS = [
  /\b(services?|offering|offerings|solution|solutions)\b/i,
  /\b(what do you do|what you do|what do you offer|what can you do|what are your services|what is your services|list your services|tell me your services|tell me about your services)\b/i,
  /\b(kia services|kya services|services kia|services kya|kia kaam|kya kaam|konsi services|kaunsi services|apki services|aapki services|servcie|servcies|srvice|srvices|sarvice|sarvices|all services)\b/i
];

export const PRICING_PATTERNS = [
  /\b(price|prices|prize|prizes|prise|prises|pricing|pricings|prizing|prizings|cost|costs|costing|costings|budget|budgets|fee|fees|charge|charges|rate|rates|quote|quotes|quotation|quotations|estimate|estimates|estimation|package|packages)\b/i,
  /\b(priz|prizing|prizings|prizng|prce|prces|prieces|priecing|pakage|pakages|pkg|pkgs|bujet|bujat|bajet)\b/i,
  /\b(how much|how much does it cost|how much money|what is the cost|what are the charges|what is the price|what are the rates|what is the prize|what are the prizes|what is the prizing|what are the prizings)\b/i,
  /\b(kitna kharcha|kitnay pesay|kitna paisa|kitnay rupay|charges kitnay|cost kitni|price kitni|rates kia|budget kitna|packages kia|charges kia hai|charges kya|cost kya|price kya|paisa lagega|paise lagenge|prizing kia|prizing kya)\b/i,
  /\b(book a call|schedule a call|consultation|book appointment|zoom call|zoom meeting|meeting|demo call|schedule meeting|appointment|schedule)\b/i
];

export const CONTACT_PATTERNS = [
  /\b(contact|phone|email|number|contact details|helpline|how to contact you|apka number|contact number|call you|reach you)\b/i
];

export const LOCATION_PATTERNS = [
  /\b(location|located|office|headquarters|address|kahan ho|kahan base ho|where are you|where are you located|where is your office|where are you based)\b/i
];

export const PROCESS_PATTERNS = [
  /\b(how it works|how does it work|process|steps|procedure|kaisay kaam karta hai|kese kaam hota hai|operational roadmap|roadmap)\b/i
];

export const SPECIFIC_SERVICE_REGEX = /\b(amazon|fba|fbm|wholesale|private label|shopify|walmart|tiktok|tik tok|etsy|ebay|temu|dropship|dropshipping|ppc|listing|audit|ebook|e-book|ghostwriting|ghostwriter|editing|proofreading|cover design|audiobook|trailer|patch|patches|embroidered|chenille|pvc|woven|apparel|promotional)\b/i;

export function hasSpecificServiceMention(text: string): boolean {
  const clean = (text || '').toLowerCase().trim();
  if (/\b(all services|other services|what other services|list all services|tell me all services)\b/i.test(clean)) {
    return false;
  }
  return SPECIFIC_SERVICE_REGEX.test(clean);
}

export function isPricingOrBookingRequested(text: string): boolean {
  const clean = (text || '').toLowerCase().trim();
  return PRICING_PATTERNS.some(p => p.test(clean));
}

export function isServicesRequested(text: string): boolean {
  const clean = (text || '').toLowerCase().trim();
  if (hasSpecificServiceMention(clean)) return false;
  return SERVICES_PATTERNS.some(p => p.test(clean));
}

export function findFirstPatternIndex(text: string, patterns: RegExp[]): number | null {
  let minIndex: number | null = null;
  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && typeof match.index === 'number') {
      if (minIndex === null || match.index < minIndex) {
        minIndex = match.index;
      }
    }
  }
  return minIndex;
}

export interface AIChatMessageItem {
  text: string;
  isForm?: boolean;
  formType?: 'booking';
}

export interface AIChatResponseResult {
  text: string;
  handoffRequired: boolean;
  isForm?: boolean;
  formType?: 'booking';
  messages?: AIChatMessageItem[];
}

export function isHumanHandoffRequested(text: string): boolean {
  const clean = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Guard: Check for conditional/deferred mention of real person (e.g. "before I talk to a real person", "prior to speaking to human")
  const conditionalAvoidRegex = /\b(before|prior to|without|instead of|rather than|dont want|don't want|before talking|before i talk|before speaking)\b.*(talk|speak|connect|chat|real person|real human|live agent|human|agent|person)/i;
  if (conditionalAvoidRegex.test(clean)) {
    return false;
  }

  // 2. Guard: If user is specifically requesting pricing, estimate, quote, or cost details:
  // The primary user intent is PRICING / CONSULTATION / ESTIMATE! AI must answer and present the Booking Form!
  if (isPricingOrBookingRequested(text)) {
    const explicitTransferOverride = /\b(transfer me|connect me|switch me|put me through|agent now|human now|stop ai|not ai)\b/i.test(clean);
    if (!explicitTransferOverride) {
      return false;
    }
  }

  // 3. Exact standalone single-phrase intent triggers (when the entire message is basically just asking for a person)
  const exactHandoffMessages = [
    'agent', 'human', 'rep', 'representative', 'real agent', 'live agent', 'real person',
    'live person', 'person', 'human please', 'agent please', 'person please', 'real support',
    'insan se baat', 'bande se baat', 'real banda', 'actual person', 'actual human', 'agent chahiye',
    'human support', 'live support', 'talk to human', 'talk to agent', 'speak to agent', 'connect to agent',
    'connect with agent', 'speak to human', 'transfer to agent', 'transfer to human', 'connect with human'
  ];
  if (exactHandoffMessages.includes(clean)) return true;

  // 4. Explicit direct transfer commands anywhere in the message
  const directTransferCommands = [
    'not ai', 'stop ai', 'transfer me', 'connect me with', 'connect me to', 'connect with real agent',
    'talk to human', 'talk to agent', 'speak to agent', 'connect to agent', 'speak to human',
    'talk to a person', 'talk to the real person', 'talk to a real person', 'talk to real man',
    'talk to a real man', 'speak to a real man', 'speak to real man', 'can i talk to a real man',
    'can i talk to real man', 'talk to real guy', 'can i talk to the real person', 'can i talk to a real person',
    'can i speak to a person', 'can i speak to a real person', 'can i talk to real person', 'transfer to real person',
    'i want to talk to a human', 'i want to speak to a person', 'i want to talk to an agent',
    'let me talk to a human', 'let me speak to an agent', 'i need a real person', 'i want a real person'
  ];
  if (directTransferCommands.some(p => clean.includes(p))) {
    return true;
  }

  // 5. Action + Target combinations (e.g. "can you connect me with your specialist representative")
  const humanKeywords = ['human', 'real agent', 'live agent', 'agent', 'person', 'someone', 'representative', 'rep', 'specialist', 'insan', 'banda'];
  const actionKeywords = ['talk to', 'speak to', 'speak with', 'connect to', 'connect with', 'transfer to', 'switch to', 'reach out to'];

  const hasAction = actionKeywords.some(a => clean.includes(a));
  const hasHuman = humanKeywords.some(h => clean.includes(h));
  return hasAction && hasHuman;
}

export function isGibberish(text: string): boolean {
  const clean = (text || '').trim().toLowerCase();
  if (clean.length < 4) return false;

  // 1. Repeated same character 4+ times in a row (e.g. "aaaaa", "zzzzzz")
  if (/(.)\1{4,}/.test(clean)) return true;

  // 2. Keyboard smash patterns
  const smashPatterns = ['asdfgh', 'sdfghj', 'dfghjk', 'qwerty', 'wertyu', 'ertyui', 'zxcvbn', 'xcvbnm', 'lkjhgf'];
  if (smashPatterns.some(p => clean.includes(p))) return true;

  // 3. Single long word >= 10 characters with very low vowel ratio or consecutive consonant clusters
  const words = clean.split(/\s+/);
  for (const w of words) {
    if (w.length >= 10 && !w.startsWith('http') && !w.includes('@')) {
      const lettersOnly = w.replace(/[^a-z]/g, '');
      if (lettersOnly.length >= 10) {
        const vowels = lettersOnly.match(/[aeiou]/g) || [];
        const vowelRatio = vowels.length / lettersOnly.length;
        if (vowelRatio < 0.22) return true;
        if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(lettersOnly)) return true;
      }
    }
  }

  return false;
}

export function isAbusiveOrInappropriate(text: string): boolean {
  const clean = (text || '').toLowerCase().trim();
  const badPatterns = [
    /\b(fuck|shit|bitch|bastard|asshole|dick|idiot|stupid|chutiya|gandu|kameena|harami|bhosdi|bakwas|pagal)\b/i
  ];
  return badPatterns.some(p => p.test(clean));
}

export function sanitizeEmDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\u2014\u2013\u2015\u2012\u2212\uFE58\uFE63\uFF0D—–―]/g, ', ')
    .replace(/\s*--+\s*/g, ', ')
    .replace(/,\s*,+/g, ', ')
    .replace(/\s*,\s*([.!?])/g, '$1')
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function buildServicesMessage(siteConfig: any, cleanName: string | null): AIChatMessageItem {
  const list = (siteConfig.services || []).map((s: string) => `• ${s}`).join('\n');
  const greeting = cleanName ? `Hey ${cleanName}! ` : '';
  const text = sanitizeEmDashes(`${greeting}At ${siteConfig.name}, we provide end-to-end e-commerce management and automation services across top global marketplaces:\n\n${list}\n\nWe handle everything from winning product research and verified manufacturer sourcing to complete storefront setup, PPC ad campaigns, and 24/7 account health management.`);
  return {
    text,
    isForm: false
  };
}

export function buildPricingMessage(siteConfig: any, cleanName: string | null): AIChatMessageItem {
  const greeting = cleanName ? `Hey ${cleanName}! ` : '';
  const text = sanitizeEmDashes(`${greeting}Our pricing is fully customized based on the scope of your project, the platform you choose (Amazon FBA, Shopify, Walmart, TikTok Shop, Etsy, or eBay), and whether you need end-to-end automation or targeted store management. We offer flexible packages tailored to fit your exact business goals and budget.\n\nPlease book a free 1-on-1 Zoom strategy meeting with our senior eCommerce specialists right below. During the call, we will walk you through our complete operational roadmap and decide on custom pricing tailored specifically to your budget and growth targets:`);
  return {
    text,
    isForm: true,
    formType: 'booking'
  };
}

export function buildLocationMessage(siteConfig: any): AIChatMessageItem {
  const text = sanitizeEmDashes(`${siteConfig.name} is headquartered in the United States, with dedicated specialist teams supporting our global clients across major North American, UK, and European marketplaces.`);
  return {
    text,
    isForm: false
  };
}

export function buildContactMessage(siteConfig: any): AIChatMessageItem {
  const phone = siteConfig.phone ? `Phone: ${siteConfig.phone}` : '';
  const email = siteConfig.email ? `Email: ${siteConfig.email}` : '';
  const contactInfo = [phone, email].filter(Boolean).join(' | ');
  const text = sanitizeEmDashes(`You can reach our team directly at ${contactInfo || 'our 24/7 live support'}. You can also type "real person" right here at any time to connect with a live representative!`);
  return {
    text,
    isForm: false
  };
}

export function buildProcessMessage(siteConfig: any): AIChatMessageItem {
  const text = sanitizeEmDashes(`Our launch and scaling process is structured in 4 key steps:\n1. Free 1-on-1 strategy and budget alignment call\n2. High-ROI product research and verified manufacturer sourcing\n3. Store creation, SEO optimization, and inventory preparation\n4. Automated PPC advertising and 24/7 daily account management.`);
  return {
    text,
    isForm: false
  };
}

export function buildSpecificServiceMessage(rawText: string, siteConfig: any, cleanName: string | null): AIChatMessageItem | null {
  const lower = (rawText || '').toLowerCase();
  const greeting = cleanName ? `Hey ${cleanName}! ` : '';

  if (/\b(amazon|fba|fbm|wholesale|private label)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}Great choice! With our Amazon FBA Automation and Account Management service at ${siteConfig.name}, our specialist team handles the entire process for you end-to-end. This includes winning high-margin product research, verified US and global supplier sourcing, Amazon Seller Central setup, SEO-optimized product listings, profitable PPC ad campaigns, and daily FBA inventory and fulfillment management.\n\nAre you looking to launch a brand-new Amazon FBA store from scratch, or scale an existing seller account? You can also ask about pricing or book a free 1-on-1 Zoom strategy call anytime!`),
      isForm: false
    };
  }

  if (/\b(shopify|dropship|dropshipping)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}We would love to help you with Shopify! Our Shopify Dropshipping and Store Automation team builds high-converting custom storefronts, researches trending high-margin products, connects verified fast-shipping suppliers, and runs targeted marketing campaigns while handling daily order fulfillment for you.\n\nAre you starting a new Shopify brand from scratch, or looking to automate and scale an existing store?`),
      isForm: false
    };
  }

  if (/\b(walmart)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}Our Walmart Marketplace Automation service covers everything from Walmart Seller Account approval and WFS (Walmart Fulfillment Services) setup to profitable product sourcing, listing optimization, and daily order and account health management.\n\nDo you already have a Walmart Seller account, or would you like our team to help you get approved and launched from scratch?`),
      isForm: false
    };
  }

  if (/\b(tiktok|tik tok)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}With our TikTok Shop Automation service, we set up your TikTok Seller Store, source viral high-converting products, manage affiliate and creator outreach, optimize shop listings, and handle daily fulfillment so you can capture fast social commerce sales hands-off.\n\nAre you looking to launch a new TikTok Shop or scale an existing brand?`),
      isForm: false
    };
  }

  if (/\b(etsy)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}Our Etsy Store Automation service handles niche product research, custom print-on-demand or handmade supplier sourcing, shop branding, SEO listing creation, and daily order fulfillment to build steady automated revenue.\n\nAre you looking to launch a new Etsy shop or grow an existing one?`),
      isForm: false
    };
  }

  if (/\b(ebay|temu)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}With our eBay and Marketplace Automation service, we handle high-demand product research, verified supplier sourcing, optimized listings, pricing automation, customer service, and daily order fulfillment to scale your store smoothly.\n\nAre you starting a brand-new store or looking to scale an existing account?`),
      isForm: false
    };
  }

  if (/\b(ebook|e-book|ghostwriting|ghostwriter|editing|proofreading|cover design|audiobook|trailer|publishing)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}We provide complete end-to-end E-book and Book Publishing services, including professional ghostwriting, developmental editing and proofreading, custom book cover design, interior formatting, audiobook production, and global distribution on Amazon KDP and major platforms.\n\nDo you already have a manuscript or draft ready, or are you starting from a new book idea?`),
      isForm: false
    };
  }

  if (/\b(ppc|listing|audit)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}Our E-commerce PPC Advertising and Listing Optimization specialists conduct deep keyword research, A+ content and SEO copywriting, and data-driven ad campaign management to lower your ACoS and boost organic rankings and sales.\n\nWhich marketplace is your store currently on, and would you like a free audit from our specialist team?`),
      isForm: false
    };
  }

  if (/\b(patch|patches|embroidered|chenille|pvc|woven|apparel|promotional)\b/i.test(lower)) {
    return {
      text: sanitizeEmDashes(`${greeting}At ${siteConfig.name}, we craft custom embroidered, chenille, PVC, leather, and woven patches as well as custom apparel and promotional merchandise with free digital artwork proofs, flexible order quantities, and fast shipping.\n\nWhat type of patch or custom item are you looking to create, and roughly how many pieces do you need?`),
      isForm: false
    };
  }

  return null;
}

export async function generateAIChatResponse({
  messages,
  visitorName,
  property = 'teals-crm',
  hostname
}: {
  messages: { role: 'user' | 'model'; content: string }[];
  visitorName?: string;
  property?: string;
  hostname?: string;
}): Promise<AIChatResponseResult> {
  const siteConfig = getWebsiteConfig(property, hostname);
  const lastMsg = (messages[messages.length - 1]?.content || '').trim();
  const lower = lastMsg.toLowerCase();

  // 1. Check Strict Human Handoff Intent
  if (isHumanHandoffRequested(lastMsg)) {
    const handoffText = `Sure! I am connecting you with a real person from ${siteConfig.shortName || siteConfig.name} right now. Please hold on for a moment while a live representative joins the chat!`;
    return {
      text: handoffText,
      messages: [{ text: handoffText }],
      handoffRequired: true
    };
  }

  const rawName = (visitorName || '').trim();
  const cleanName = rawName && rawName.toLowerCase() !== 'visitor' && rawName.toLowerCase() !== 'you' ? rawName : null;

  // 2. Check for Inappropriate / Abusive Language
  if (isAbusiveOrInappropriate(lastMsg)) {
    const abuseText = `We are committed to maintaining a respectful and professional environment for all clients and team members. Please let us know how we can assist you with our official ${siteConfig.name} services, or feel free to contact our support team at ${siteConfig.phone || siteConfig.email || 'our live helpline'}.`;
    return {
      text: abuseText,
      messages: [{ text: abuseText }],
      handoffRequired: false
    };
  }

  // 3. Check for Gibberish / Keyboard Smashing (e.g. "aaaaa", "lkladjaldlawdhwlahd")
  if (isGibberish(lastMsg)) {
    const gibText = cleanName
      ? `Hey ${cleanName}, I didn't quite catch that! Could you please let me know what questions you have about our services?`
      : `I didn't quite catch that! Could you please let me know what questions you have about our services?`;
    return {
      text: gibText,
      messages: [{ text: gibText }],
      handoffRequired: false
    };
  }

  // 4. Standalone Greetings (Only when message is strictly a greeting, without trailing question)
  if (/^(hey|hi|hello|heyy|salam|aoa|hola|good morning|good afternoon|good evening|hey bro|hi there|hello there|heyy bro|what'?s up|sup|yo|kia hal|kya hal|kia haal|kese ho|kaise ho)[\s!?.]*$/i.test(lower)) {
    const greetText = cleanName ? `Hey ${cleanName}, how can I help you today?` : 'Hey, how can I help you today?';
    return {
      text: greetText,
      messages: [{ text: greetText }],
      handoffRequired: false
    };
  }

  // 5. Multi-Topic / Multi-Intent Detection & Sequence Extraction
  // Find where each intent starts in the user's message so we can answer them in the EXACT order the user asked!
  const hasSpecificService = hasSpecificServiceMention(lastMsg);
  const specificServiceMsg = hasSpecificService ? buildSpecificServiceMessage(lastMsg, siteConfig, cleanName) : null;
  const detected: Array<{ type: 'services' | 'specific_service' | 'pricing' | 'contact' | 'location' | 'process'; index: number }> = [];

  if (hasSpecificService && specificServiceMsg) {
    const specIdx = findFirstPatternIndex(lastMsg, [SPECIFIC_SERVICE_REGEX]);
    if (specIdx !== null) detected.push({ type: 'specific_service', index: specIdx });
  } else {
    const sIdx = findFirstPatternIndex(lastMsg, SERVICES_PATTERNS);
    if (sIdx !== null) detected.push({ type: 'services', index: sIdx });
  }

  const pIdx = findFirstPatternIndex(lastMsg, PRICING_PATTERNS);
  if (pIdx !== null) detected.push({ type: 'pricing', index: pIdx });

  const lIdx = findFirstPatternIndex(lastMsg, LOCATION_PATTERNS);
  if (lIdx !== null) detected.push({ type: 'location', index: lIdx });

  const cIdx = findFirstPatternIndex(lastMsg, CONTACT_PATTERNS);
  if (cIdx !== null) detected.push({ type: 'contact', index: cIdx });

  const prIdx = findFirstPatternIndex(lastMsg, PROCESS_PATTERNS);
  if (prIdx !== null) detected.push({ type: 'process', index: prIdx });

  // Strictly sort by index ascending so answers match the user's question sequence!
  detected.sort((a, b) => a.index - b.index);

  // If user asked MULTIPLE intents (e.g. Services AND Cost, or Specific Service AND Cost, or with Location/Contact):
  // Return separate distinct messages in that exact user order!
  if (detected.length >= 2) {
    const multiMsgs: AIChatMessageItem[] = [];
    for (const item of detected) {
      if (item.type === 'specific_service' && specificServiceMsg) multiMsgs.push(specificServiceMsg);
      else if (item.type === 'services') multiMsgs.push(buildServicesMessage(siteConfig, cleanName));
      else if (item.type === 'pricing') multiMsgs.push(buildPricingMessage(siteConfig, cleanName));
      else if (item.type === 'location') multiMsgs.push(buildLocationMessage(siteConfig));
      else if (item.type === 'contact') multiMsgs.push(buildContactMessage(siteConfig));
      else if (item.type === 'process') multiMsgs.push(buildProcessMessage(siteConfig));
    }
    const hasPricing = multiMsgs.some(m => m.isForm);
    return {
      text: multiMsgs[0].text,
      messages: multiMsgs,
      handoffRequired: false,
      isForm: hasPricing,
      formType: hasPricing ? ('booking' as const) : undefined
    };
  }

  // Single direct intent inquiries:
  if (detected.length === 1) {
    if (detected[0].type === 'pricing') {
      const pMsg = buildPricingMessage(siteConfig, cleanName);
      return {
        text: pMsg.text,
        messages: [pMsg],
        handoffRequired: false,
        isForm: true,
        formType: 'booking'
      };
    }

    if (detected[0].type === 'services' && lastMsg.split(/\s+/).length <= 15) {
      const sMsg = buildServicesMessage(siteConfig, cleanName);
      return {
        text: sMsg.text,
        messages: [sMsg],
        handoffRequired: false,
        isForm: false
      };
    }

    if (detected[0].type === 'contact' && lastMsg.split(/\s+/).length <= 12) {
      const cMsg = buildContactMessage(siteConfig);
      return {
        text: cMsg.text,
        messages: [cMsg],
        handoffRequired: false,
        isForm: false
      };
    }

    if (detected[0].type === 'location' && lastMsg.split(/\s+/).length <= 12) {
      const lMsg = buildLocationMessage(siteConfig);
      return {
        text: lMsg.text,
        messages: [lMsg],
        handoffRequired: false,
        isForm: false
      };
    }

    if (detected[0].type === 'process' && lastMsg.split(/\s+/).length <= 12) {
      const prMsg = buildProcessMessage(siteConfig);
      return {
        text: prMsg.text,
        messages: [prMsg],
        handoffRequired: false,
        isForm: false
      };
    }
  }

  // Quick status checks & acknowledgements
  if (/^(fine|good|great|doing good|doing well|i am good|i am fine|all good|thk|theek|alright|ok|okay)[\s!?.]*$/i.test(lower)) {
    const stText = `Glad to hear that! How can I help you regarding our ${siteConfig.shortName} services today?`;
    return {
      text: stText,
      messages: [{ text: stText }],
      handoffRequired: false
    };
  }

  // Quick appreciations
  if (/^(thanks|thank you|shukriya|thx|cool|nice|ok bro|alright bro|done|got it)[\s!?.]*$/i.test(lower)) {
    const thxText = `You're very welcome! Feel free to ask any other questions about ${siteConfig.name}, or type "real person" if you'd like to chat with a live representative.`;
    return {
      text: thxText,
      messages: [{ text: thxText }],
      handoffRequired: false
    };
  }

  const isAskingServices = isServicesRequested(lastMsg);
  const contactText = [
    siteConfig.phone ? `Phone: ${siteConfig.phone}` : '',
    siteConfig.email ? `Email: ${siteConfig.email}` : ''
  ].filter(Boolean).join(' | ');

  const systemPrompt = `${siteConfig.systemPrompt}
${cleanName ? `\nThe visitor's name is "${cleanName}". Address them warmly by name when appropriate.` : ''}

OFFICIAL WEBSITE KNOWLEDGE & DETAILS:
- Website Name: ${siteConfig.name} (${siteConfig.shortName})
- Official Phone: ${siteConfig.phone || 'Available via live support'}
- Official Email: ${siteConfig.email || 'Available via live support'}
- Official Services: ${(siteConfig.services || []).join(', ')}

CORE OPERATING INSTRUCTIONS:
1. UNDERSTAND USER INTENT: Understand user queries in English, Roman Urdu (e.g. "kia services hain", "fba kya hai", "charges kitnay hain", "store setup kaisa hota ha", etc.), Hindi, or any language.
2. STRICTLY ENGLISH RESPONSES: ALWAYS write your final response in clear, professional, friendly English only. Never respond in Roman Urdu or Urdu script.
3. MULTI-QUESTION & SEPARATION MANDATE:
   - When a visitor asks multiple questions or topics in a single message:
     a) Address EVERY question the visitor asked, strictly in the exact order they asked them!
     b) Separate each distinct answer with the exact marker:
        ---MESSAGE_SPLIT---
     c) Never group distinct questions into one giant wall of text when separate questions were asked.
     d) If one of the questions asks about pricing, packages, or costs, explain that pricing is customized to project scope and invite them to book a free 1-on-1 strategy meeting using the consultation booking form right below in the chat.
4. KNOWLEDGE-BASED ANSWERS & SERVICES:
   - When the user asks about services, list and clearly explain our core offerings: ${(siteConfig.services || []).join(', ')}.
   - Answer questions about ${siteConfig.name}'s services, platforms, and offerings directly, intelligently, and helpfully from our official website knowledge.
   - NEVER deflect a general service or platform question to phone/email!
5. UNKNOWN / OUT-OF-SCOPE / CUSTOM QUERIES: ONLY if the visitor asks about completely unrelated topics (e.g. medical advice, unrelated software, car repair, cryptocurrency, etc.) or requires private account credentials:
   - Politely explain what we specialize in.
   - Provide the website's official contact info (${contactText || 'our support team'}).
   - Explicitly inform the visitor: "You can also type 'real person' right here to connect with a live representative as soon as they are online."
6. PRICING & QUOTATION INQUIRIES:
   - If the visitor asks about pricing, costs, rates, fees, prizes, packages, or estimates:
   - Explain clearly that pricing is customized based on project scope, platform requirements, and automation tier.
   - ALWAYS invite the visitor to book a free 1-on-1 Zoom strategy meeting with our senior eCommerce specialist team using the interactive consultation booking form right below in the chat. During the call, we review the complete roadmap and finalize custom pricing tailored specifically to their budget.
   - NEVER tell the visitor to call a phone number or type "real person" when they ask for pricing or an estimate!
7. HUMAN HANDOFF: If the user explicitly asks to speak to a real human, live person, or agent (e.g. "real person", "real agent", "talk to human", "live agent", "insan se baat"):
   - Append "[HANDOFF_REQUIRED]" at the very end of your response ONLY if they are directly asking for a handoff. NEVER append it if they say "before I talk to a real person" or ask for an estimate/quote first.
8. NO REPETITIVE CANNED RESPONSES: If the visitor mentions a specific platform or service (e.g. "I need Amazon FBA", "I want Shopify", "Walmart", "Dropshipping", etc.), immediately dive into explaining what we do for that specific platform (winning product research, verified supplier sourcing, store setup, PPC campaigns, and daily fulfillment) and ask about their goals.
9. DYNAMIC PHRASING: Keep responses fresh, motivating, and action-oriented (2-4 well-structured sentences).
10. NO ROBOTIC PREFIXES: Never include prefixes like "Assistant:", "Tone: Warm", or internal thoughts. Return only the final clean message.
11. CRITICAL PUNCTUATION MANDATE: NEVER use em dashes ('—'), en dashes ('–'), double hyphens ('--'), horizontal bars ('―'), or double em dashes ('——') anywhere in your responses! Always use standard commas (,), full stops (.), or natural sentences instead.
${isAskingServices ? `\nCRITICAL: The visitor is asking about our SERVICES. You MUST list and describe the official services offered by ${siteConfig.name} clearly and comprehensively.` : ''}
${isPricingOrBookingRequested(lastMsg) ? `\nCRITICAL PRICING & QUOTATION INSTRUCTION: The visitor is inquiring about PRICING, ESTIMATES, PACKAGES, or PRIZES. Explain clearly that our pricing is tailored to project scope and automation level, and warmly invite them to book a free 1-on-1 Zoom consultation with our senior specialist using the booking card directly below in the chat to review the strategy and finalize custom pricing. DO NOT deflect to phone numbers, and DO NOT tell them to type "real person"!` : ''}`;

  // Ultra-fast Gemini models ordered by speed, stability, and availability
  const modelsToTry = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest'
  ];

  const keysToTry = getGeminiKeyPool(siteConfig.geminiApiKey);

  for (const key of keysToTry) {
    const aiClient = new GoogleGenerativeAI(key);

    for (const modelName of modelsToTry) {
      try {
        const model = aiClient.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
          generationConfig: {
            maxOutputTokens: 1600,
            temperature: 0.7
          }
        });

        // Slice to recent messages excluding the current prompt
        const conversationHistory = messages.slice(-5, -1).map(m => ({
          role: m.role === 'user' ? 'user' as const : 'model' as const,
          parts: [{ text: m.content }]
        }));

        while (conversationHistory.length > 0 && conversationHistory[0].role !== 'user') {
          conversationHistory.shift();
        }

        const cleanHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
        for (const item of conversationHistory) {
          if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === item.role) {
            cleanHistory[cleanHistory.length - 1].parts[0].text += '\n' + item.parts[0].text;
          } else {
            cleanHistory.push(item);
          }
        }

        const chat = model.startChat({
          history: cleanHistory
        });

        // 12s timeout promise race so the model has enough time to generate full grounded response
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000));
        const sendPromise = chat.sendMessage(lastMsg);
        const result = await Promise.race([sendPromise, timeoutPromise]);

        if (!result) {
          console.warn(`Model ${modelName} timed out after 12s, trying next...`);
          continue;
        }

        const rawText = result.response.text();
        const handoffRequired = isHumanHandoffRequested(lastMsg);
        let cleanText = rawText
          .replace(/\[HANDOFF_REQUIRED\]/g, '')
          .replace(/^(Tone|Style|Role|Assistant|Response):\s*[\w\s,.-]+[\r\n]*/i, '')
          .replace(/^Tone:\s*Warm,?\s*/i, '')
          .trim();

        const isPricing = isPricingOrBookingRequested(lastMsg) ||
          isPricingOrBookingRequested(cleanText) ||
          /booking form|consultation booking|strategy meeting|1-on-1|zoom meeting|custom package|pricing is/i.test(cleanText);

        // Check if Gemini split its response into multiple discrete answers
        if (cleanText.includes('---MESSAGE_SPLIT---')) {
          const rawParts = cleanText.split(/---MESSAGE_SPLIT---/i).map(p => p.trim()).filter(Boolean);
          if (rawParts.length > 1) {
            const parts: AIChatMessageItem[] = rawParts.map(p => {
              const isPartPricing = isPricingOrBookingRequested(p) ||
                /booking form|consultation booking|strategy meeting|1-on-1|zoom meeting|pricing is/i.test(p);
              return {
                text: sanitizeEmDashes(p),
                isForm: isPartPricing,
                formType: isPartPricing ? ('booking' as const) : undefined
              };
            });

            if (isPricing && !parts.some(p => p.isForm)) {
              const pIdx = parts.findIndex(p => /price|pricing|prizing|prize|cost|budget|package|call|meeting|booking form|consultation/i.test(p.text));
              if (pIdx !== -1) {
                parts[pIdx].isForm = true;
                parts[pIdx].formType = 'booking';
              } else {
                parts[parts.length - 1].isForm = true;
                parts[parts.length - 1].formType = 'booking';
              }
            }

            return {
              text: parts[0].text,
              messages: parts,
              handoffRequired,
              isForm: parts.some(p => p.isForm),
              formType: parts.some(p => p.isForm) ? ('booking' as const) : undefined
            };
          }
        }

        if (cleanText && cleanText.length > 3 && !cleanText.toLowerCase().startsWith('tone:')) {
          return {
            text: sanitizeEmDashes(cleanText),
            messages: [{
              text: sanitizeEmDashes(cleanText),
              isForm: isPricing,
              formType: isPricing ? ('booking' as const) : undefined
            }],
            handoffRequired,
            isForm: isPricing,
            formType: isPricing ? ('booking' as const) : undefined
          };
        }
      } catch (err: unknown) {
        const errMsg = (err as Error)?.message || '';
        console.warn(`Model ${modelName} with key ${key?.substring(0, 8)}... failed:`, errMsg);
        if (
          errMsg.includes('API_KEY_INVALID') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('429') ||
          errMsg.includes('quota') ||
          errMsg.includes('Quota') ||
          errMsg.includes('rate limit')
        ) {
          console.warn('API key rate limit, quota or invalid error encountered. Cooldown registered...');
          exhaustedKeysCooldown.set(key, Date.now() + 60000);
          break; // Try next key in the pool immediately!
        }
      }
    }
  }

  // Fallback if AI models were offline/exhausted: construct messages from detected intents in user order
  if (detected.length > 0) {
    const fallbackMsgs: AIChatMessageItem[] = [];
    for (const item of detected) {
      if (item.type === 'specific_service' && specificServiceMsg) fallbackMsgs.push(specificServiceMsg);
      else if (item.type === 'services') fallbackMsgs.push(buildServicesMessage(siteConfig, cleanName));
      else if (item.type === 'pricing') fallbackMsgs.push(buildPricingMessage(siteConfig, cleanName));
      else if (item.type === 'location') fallbackMsgs.push(buildLocationMessage(siteConfig));
      else if (item.type === 'contact') fallbackMsgs.push(buildContactMessage(siteConfig));
      else if (item.type === 'process') fallbackMsgs.push(buildProcessMessage(siteConfig));
    }
    const hasP = fallbackMsgs.some(m => m.isForm);
    return {
      text: fallbackMsgs[0].text,
      messages: fallbackMsgs,
      handoffRequired: false,
      isForm: hasP,
      formType: hasP ? ('booking' as const) : undefined
    };
  }

  if (specificServiceMsg) {
    return {
      text: specificServiceMsg.text,
      messages: [specificServiceMsg],
      handoffRequired: false,
      isForm: false
    };
  }

  // If services were requested, provide direct official services breakdown
  if (isAskingServices) {
    const sMsg = buildServicesMessage(siteConfig, cleanName);
    return {
      text: sMsg.text,
      messages: [sMsg],
      handoffRequired: false,
      isForm: false
    };
  }

  // Fast grounded fallback providing official contacts & real person guidance
  const fallbackContacts = [
    siteConfig.phone ? `phone at ${siteConfig.phone}` : '',
    siteConfig.email ? `email at ${siteConfig.email}` : ''
  ].filter(Boolean).join(' or ');

  const fbText = sanitizeEmDashes(fallbackContacts
    ? `Thank you for reaching out to ${siteConfig.name}! For specific details or inquiries, please contact us via ${fallbackContacts}, or simply type "real person" to connect with a live representative as soon as they are online.`
    : `Thank you for reaching out to ${siteConfig.name}! Please ask any questions about our services, or type "real person" to connect directly with a live representative as soon as they are online.`);

  return {
    text: fbText,
    messages: [{ text: fbText }],
    handoffRequired: false
  };
}
