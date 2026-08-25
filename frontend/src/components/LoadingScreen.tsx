import './LoadingScreen.css';

/**
 * Пасивний екран очікування. Нічого не запитує і нікуди не веде — і це головна
 * його властивість, а не спрощення.
 *
 * Раніше компонент сам тягнув `GET /user/me` і з `useEffect` робив
 * `navigate('/', { replace: true })`, щойно запит перестане бути `isLoading`.
 * Той самий компонент стоїть фолбеком `Suspense` для лінивої `/admin`
 * (див. App.tsx), а профіль до того моменту вже лежить у кеші React Query —
 * тобто фолбек редиректив оператора на головну рівно тоді, коли чанк адмінки
 * завантажувався вперше й фолбек справді монтувався. Профіль однаково
 * запитують самі екрани, тож прогрів кешу тут нічого не давав.
 */
interface LoadingScreenProps {
  /** Підпис під спінером. Дефолт — стартове завантаження застосунку. */
  text?: string;
}

function LoadingScreen({ text = 'Завантаження SlangUA…' }: LoadingScreenProps) {
  return (
    <div className="loading-screen" role="status" aria-label={text}>
      <div className="loading-spinner" aria-hidden="true" />
      <p className="loading-text">{text}</p>
    </div>
  );
}

export default LoadingScreen;
