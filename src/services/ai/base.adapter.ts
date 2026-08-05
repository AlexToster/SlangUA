/**
 * Base AI Adapter
 * 
 * Abstract base class providing common functionality for all AI providers:
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - Configuration management
 */

import { AIProvider } from '@prisma/client';
import { IAIProvider, TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';

export abstract class BaseAdapter implements IAIProvider {
  abstract readonly provider: AIProvider;
  abstract readonly model: string;

  protected readonly config: ProviderConfig;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    this.config = {
      enabled: providerConfig.enabled ?? true,
      apiKey: providerConfig.apiKey,
      timeout: providerConfig.timeout ?? 30000,
      maxRetries: providerConfig.maxRetries ?? config.AI_MAX_RETRIES,
      retryDelayMs: providerConfig.retryDelayMs ?? config.AI_RETRY_DELAY_MS,
      priority: providerConfig.priority ?? 0,
    };
  }

  /**
   * Check if provider is configured and available
   */
  isAvailable(): boolean {
    return this.config.enabled && !!this.config.apiKey;
  }

  /**
   * Translate text to slang style - must be implemented by subclasses
   */
  abstract translate(request: TranslateRequest): Promise<TranslateResponse>;

  /**
   * Execute a function with timeout
   */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Execute a function with retry logic
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = this.config.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain errors (e.g., invalid API key, bad request)
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (attempt < maxAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is non-retryable
   * Override in subclasses for provider-specific logic
   */
  protected isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Common non-retryable errors
      if (message.includes('invalid api key') ||
          message.includes('unauthorized') ||
          message.includes('forbidden') ||
          message.includes('bad request') ||
          message.includes('quota exceeded') ||
          message.includes('insufficient_quota')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build system prompt for slang translation
   */
  protected buildSystemPrompt(style: string): string {
    const stylePrompts: Record<string, string> = {
      GEN_Z: `Переклади текст на сучасний український молодежний/інтернет-сленг.
Використовуй лексику, яку реально вживають українські говірці онлайн і в мові:
"крінж", "база", "скил", "флекс", "рофл", "тріш", "аймба", "чіл", "вайб",
"ломіти", "залітати", "кілка", "донат", "фарм", "грінд", "нерф", "баф",
"ОП", "імба", "прокач", "лейт", "арлі", "мід", "лейт гейм", "раш", "кемп",
"пуш", "ініт", "фокус", "таргет", "пік", "контр", "каунтер", "мета",
"оффмета", "смаф", "буст", "дуо", "тріо", "сквад", "ранк", "ліга", "діва",
"імп", "бейн", "пік", "бан", "додж", "ремейк", "фф", "гг", "ггвп", "нп",
"тхх", "кек", "лол", "лмао", "омг", "втф", "айдікей", "ок", "гуд", "бад",
"норм", "топ", "флоп", "фейл", "епік", "легендарно", "міфічне".
Зберігай природний, розмовний стиль.`,

      STREET: `Переклади текст на українську вуличну/міську розмовну мову.
Використовуй автентичну міську лексику:
"хата", "дружина/друзі", "братва", "пацани", "гопники", "мажори", "форси",
"менти", "бульбаш", "бабки", "бабло", "грішники", "хабар", "откат", "роздача",
"кровець", "підкид", "підстава", "розвідка", "навар", "базар", "базарювати",
"перебазарювати", "не базар", "слово", "чесне слово", "на честі", "без обману",
"реально", "фактично", "по суті", "коротко", "по життю", "жиза", "жизненно",
"життєво", "реальність", "доля", "судьба", "карма", "прикид", "ситуація",
"проблема", "беда", "труба", "капець", "фініш", "кінець", "все", "бобро",
"нормально", "класно", "круто", "жорстко", "потужно", "сильно", "авторитет",
"респект", "повага", "шануваю", "підтримую", "зрозумів", "чув", "відчуваю",
"знаю", "бачив", "був", "знаюся", "розбираюся", "професіонал", "спеціаліст",
"майстер", "золота рука", "душа компанії", "козел", "козлик", "козлики",
"в козликах", "не в козликах", "в тему", "не в тему", "в курсі", "не в курсі",
"в темі", "не в темі".
Текст має звучати сурово, життєво, по-міськи.`,

      IT_SLANG: `Переклади текст на сленг українських розробників.
Використовуй українськізовані англійські технічні терміни, які реально вживають українські девелопери:
"задеплоїти", "запушити", "пулл-реквест", "мерджити", "рефакторити", "дебажити",
"фіксити", "багфікс", "хотфікс", "ролбек", "продакшн", "стейджінг", "девелопмент",
"локалка", "енви", "конфіг", "контейнер", "докер", "кубер", "кейтс", "мікросервіси",
"апі", "ендпоінт", "латентність", "тхрупут", "скейлабельність", "обсервабельність",
"логі", "метрики", "трейсинг", "алерт", "інцидент", "онкол", "пейджер", "есла",
"есло", "еслі", "технічний борг", "легасі", "код-рев'ю", "лінт", "тести",
"юніт-тести", "інтеграційні тести", "е2е", "пайплайн", "білд", "коміт", "бранч",
"гіт", "гітхаб", "гітлаб", "бітбакет", "джіра", "конфлюенс", "слек", "дзум",
"мітінг", "стендап", "ретро", "планування", "грумінг", "спрінт", "беклог", "сторі",
"таск", "баг", "епік", "фіч", "реліз", "версія", "тег", "чейнджлог", "документація",
"реадмі", "міграція", "сідер", "фабрика", "мок", "стаб", "спай", "асершн", "каверідж",
"CI/CD", "Дженкінс", "Гітлаб CI", "Гітхаб Actions", "Арго", "Флакс", "Гельм",
"чарт", "валуе", "сикрет", "конфігмап", "пвц", "пв", "под", "сервіс", "інгрес",
"неймспейс", "кластер", "нода", "поді", "контейнери", "імедж", "регістрі", "харбор",
"докерхаб", "кві", "профайлінг", "оптимізація", "бенчмарк", "профайлер", "флеймграф",
"CPU", "RAM", "диск", "мережа", "IOPS", "тхрупут", "латентність", "п99", "п95", "п50",
"еррор рейт", "аптайм", "даунтайм", "SLA", "SLO", "SLI".
Говори як девелопер з девелопером — граматично українською, але з технологічною лексикою.`,

      POFENI: `Переклади текст на автентичний український в'язницький/бандитський сленг ("зеківська/бандитська розмовна мова").
Результат має звучати загрозливо, нахабно і "по-тюремному". Використовуй лексику:
хата, шконка, параша, зона, лагер, кича, шизо, пахан, авторитет, блатний, злодій, братва,
кореші, подельники, мужик, фраєр, пасажир, лох, мусора, вертухай, кум, стукач, дятєл, шнирь,
шестірка, фармазон, кидала, заточка, пєро, малява, прогон, ґрєв, пайка, общак, делюга, лаве,
бабло, зелень, капуста, базар, базарити, терти, феніти, понятія, по понятіям, за базар відповіси,
пред'ява, пред'являти, рамси, рамси попутати, без рамсів, качати права, наїзд, наїжджати, маза,
є маза, понт, без понтів, розборка, сходка, косяк, запороти, зашквар, зашкварений, підстава,
зливати, здавати, палити, колотися, розводити, завалити, замочити, влетіти, попадос, раму зібрати,
врубатися, не по масті, по масті, фуфло.`,

      KANCLER: `Переклади текст на бюрократичну, канцелярську та офіційно-ділову українську ("канцелярський").
Результат має звучати суворо, сухо, формально та максимально бюрократизовано, створюючи навмисно гіперболічний ефект офіційного стилю. Використовуй канцелярські кліше:
вищезазначений, у зв'язку з викладеним, надати чинності, здійснювати заходи,
у разі потреби, повідомляємо наступне, згідно з чинним законодавством, встановити факт,
забезпечити виконання, відповідно до пункту, надалі за текстом, беручи до уваги,
суб'єкт господарювання.
Текст має звучати суворо офіційно, сухо та канцеляристо.`,
    };

    const basePrompt = `You are a slang translator. Your task is to translate the given text into the specified slang style.
Rules:
1. Only return the translated text, nothing else
2. Do not add explanations, quotes, or formatting
3. Keep the meaning but make it sound natural in the target slang
4. If the input is already in that slang, return it as-is
5. Handle any language input (Ukrainian, Russian, English, etc.)`;

    return `${basePrompt}\n\nStyle: ${stylePrompts[style] || stylePrompts.GEN_Z}`;
  }
}