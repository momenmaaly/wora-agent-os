/**
 * Financial-intent detection for browser actions.
 *
 * A browser click, payment-field entry or payment-method selection that can
 * commit or move money is a class C action. The detector is intentionally
 * conservative: it fails closed for financial-looking labels/fields and leaves
 * ordinary navigation, reading and non-financial interaction alone.
 */

export type BrowserFinancialAction = 'click' | 'type' | 'select';

export interface FinancialIntent {
  required: boolean;
  reason: string;
  amountUsd?: number;
}

const COMMIT_WORDS = /(?:pay(?:ment)?\b|purchase\b|checkout\b|buy\s+now\b|\bbuy\b|place\s+order\b|complete\s+order\b|submit\s+order\b|transfer\s+funds\b|send\s+money\b|withdraw\b|deposit\b|donate\b|subscribe\b|billing\b|invoice\b|credit\s+card\b|debit\s+card\b|card\s+number\b|\bcvv\b|\bcvc\b|\biban\b|routing\s+number\b|amount\s+due\b|total\s+due\b|شراء|دفع|سداد|تحويل\s+الأموال|تبرع|اشتراك|فاتورة|بطاقة)/iu;
const FINANCIAL_FIELD = /(?:card|payment|checkout|billing|iban|account|routing|cvv|cvc|expiry|wallet|payee|recipient|amount|price|total)/iu;
const CARD_LIKE = /(?:\b(?:\d[ -]*?){13,19}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b)/u;
const AMOUNT = /(?:USD|EUR|GBP|SAR|AED|\$|€|£|﷼)\s*([0-9][0-9,._]*)|([0-9][0-9,._]*)\s*(?:USD|EUR|GBP|SAR|AED)/iu;

export function extractBrowserAmount(value: string): number | undefined {
  const match = AMOUNT.exec(value);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const amount = Number(raw.replace(/,/gu, ''));
  return Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000 ? amount : undefined;
}

export function financialIntent(action: BrowserFinancialAction, input: Record<string, unknown>): FinancialIntent {
  if (action === 'click') {
    const value = [input['text'], input['selector'], input['href'], input['label']].filter((item): item is string => typeof item === 'string').join(' ');
    if (COMMIT_WORDS.test(value)) {
      return { required: true, reason: 'This browser interaction can complete a purchase, payment or money transfer.', ...(extractBrowserAmount(value) !== undefined ? { amountUsd: extractBrowserAmount(value) } : {}) };
    }
    return { required: false, reason: 'No financial commitment is detected.' };
  }
  const selector = typeof input['selector'] === 'string' ? input['selector'] : '';
  const text = typeof input['text'] === 'string' ? input['text'] : '';
  const value = typeof input['value'] === 'string' ? input['value'] : '';
  if (FINANCIAL_FIELD.test(selector) || CARD_LIKE.test(text) || CARD_LIKE.test(value)) {
    return { required: true, reason: 'This browser interaction captures payment or financial-account data.', ...(extractBrowserAmount(text) !== undefined ? { amountUsd: extractBrowserAmount(text) } : {}) };
  }
  return { required: false, reason: 'No financial commitment is detected.' };
}

export function financialActionForTool(toolId: string): BrowserFinancialAction | null {
  if (toolId === 'browser.click') return 'click';
  if (toolId === 'browser.type') return 'type';
  if (toolId === 'browser.select') return 'select';
  return null;
}
