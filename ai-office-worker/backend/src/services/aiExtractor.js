const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { logger } = require('../utils/logger');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXTRACTION_PROMPT = `You are a financial document AI assistant for an Israeli small business.
Analyze the following text/content extracted from an email and identify if it's a financial document.

Extract ALL available information. Respond ONLY with valid JSON (no markdown, no explanation).

Required JSON structure:
{
  "isFinancial": true/false,
  "confidence": 0.0-1.0,
  "vendorName": "string or null",
  "docType": "INVOICE|RECEIPT|PAYMENT_REQUEST|QUOTE|OTHER",
  "invoiceNumber": "string or null",
  "docDate": "YYYY-MM-DD or null",
  "paymentDueDate": "YYYY-MM-DD or null",
  "amountPreTax": number or null,
  "taxAmount": number or null,
  "totalAmount": number or null,
  "currency": "ILS|USD|EUR or null",
  "requiresAction": true/false,
  "suggestedStatus": "NEW|PAID|OVERDUE|NEEDS_REVIEW|MISSING_INVOICE",
  "notes": "brief explanation in Hebrew or English"
}

Rules:
- If VAT/מע"מ is 17% of net amount, calculate it
- If only total is visible, set totalAmount and leave others null
- requiresAction = true if: payment is due soon, action requested, approval needed
- suggestedStatus = NEEDS_REVIEW if confidence < 0.6
- suggestedStatus = OVERDUE if paymentDueDate is in the past
- Prefer Hebrew vendor names as they appear in the document`;

/**
 * Extract financial data from email text content.
 */
const extractFromText = async (text, subject = '') => {
  const content = `Email Subject: ${subject}\n\nEmail Content:\n${text}`;
  return callAI(content, 'text');
};

/**
 * Extract financial data from an image (attachment).
 * imageData: base64 encoded image
 */
const extractFromImage = async (imageData, mimeType = 'image/jpeg', subject = '') => {
  const provider = process.env.AI_PROVIDER || 'anthropic';

  try {
    if (provider === 'anthropic') {
      const res = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageData,
              },
            },
            {
              type: 'text',
              text: `${EXTRACTION_PROMPT}\n\nEmail Subject: ${subject}\n\nPlease analyze this document image.`,
            },
          ],
        }],
      });
      return parseAIResponse(res.content[0].text);
    } else {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${EXTRACTION_PROMPT}\n\nEmail Subject: ${subject}` },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageData}`,
                detail: 'high',
              },
            },
          ],
        }],
      });
      return parseAIResponse(res.choices[0].message.content);
    }
  } catch (err) {
    logger.error('AI image extraction failed', { error: err.message });
    return getDefaultExtraction();
  }
};

const callAI = async (content, type = 'text') => {
  const provider = process.env.AI_PROVIDER || 'anthropic';

  try {
    if (provider === 'anthropic') {
      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\n${content}`,
        }],
      });
      return parseAIResponse(res.content[0].text);
    } else {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content },
        ],
      });
      return parseAIResponse(res.choices[0].message.content);
    }
  } catch (err) {
    logger.error('AI text extraction failed', { error: err.message });
    return getDefaultExtraction();
  }
};

const parseAIResponse = (text) => {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    logger.warn('Failed to parse AI JSON response', { text: text.slice(0, 200) });
    return getDefaultExtraction();
  }
};

const getDefaultExtraction = () => ({
  isFinancial: false,
  confidence: 0,
  vendorName: null,
  docType: 'OTHER',
  invoiceNumber: null,
  docDate: null,
  paymentDueDate: null,
  amountPreTax: null,
  taxAmount: null,
  totalAmount: null,
  currency: 'ILS',
  requiresAction: false,
  suggestedStatus: 'NEEDS_REVIEW',
  notes: 'AI extraction failed - requires manual review',
});

const TASK_ANALYSIS_PROMPT = `You analyze business emails for a Hebrew-speaking small business owner.
Decide if the email requires a follow-up task (not a financial invoice/receipt).

Respond ONLY with valid JSON (no markdown):
{
  "isActionable": true/false,
  "summary": "תקציר קצר של המייל בעברית",
  "requiredAction": "מה צריך לעשות בעקבות המייל",
  "priority": "גבוה|בינוני|נמוך",
  "suggestedDueDate": "YYYY-MM-DD or empty string",
  "isUrgent": true/false
}

Rules:
- isActionable=false for newsletters, ads, automated notifications with no action needed
- isActionable=true for client requests, supplier messages, meetings, approvals, questions
- priority גבוה for urgent deadlines or isUrgent=true
- suggestedDueDate only if clearly mentioned or strongly implied`;

const getDefaultTaskAnalysis = () => ({
  isActionable: false,
  summary: '',
  requiredAction: '',
  priority: 'בינוני',
  suggestedDueDate: '',
  isUrgent: false,
});

const parseTaskResponse = (text) => {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return getDefaultTaskAnalysis();
  }
};

const analyzeEmailForTask = async (email) => {
  const content = `שולח: ${email.senderName || email.senderEmail || ''}
נושא: ${email.subject || ''}
תוכן:
${email.bodyText || email.snippet || ''}`;

  const provider = process.env.AI_PROVIDER || 'anthropic';

  try {
    if (provider === 'anthropic') {
      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `${TASK_ANALYSIS_PROMPT}\n\n${content}`,
        }],
      });
      const parsed = parseTaskResponse(res.content[0].text);
      return { ...getDefaultTaskAnalysis(), ...parsed };
    }

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: TASK_ANALYSIS_PROMPT },
        { role: 'user', content },
      ],
    });
    const parsed = parseTaskResponse(res.choices[0].message.content);
    return { ...getDefaultTaskAnalysis(), ...parsed };
  } catch (err) {
    logger.error('AI task analysis failed', { error: err.message });
    return getDefaultTaskAnalysis();
  }
};

const priorityToInt = (priority) => {
  const p = String(priority || '').toLowerCase();
  if (p.includes('גבוה') || p === 'high') return 1;
  if (p.includes('נמוך') || p === 'low') return 3;
  return 2;
};

module.exports = { extractFromText, extractFromImage, analyzeEmailForTask, priorityToInt };
