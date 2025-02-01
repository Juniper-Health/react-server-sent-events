import { useState, useEffect, useCallback, useRef } from 'react';

export class SSEError extends Error {
    constructor(
        message: string,
        public readonly code?: string
    ) {
        super(message);
        this.name = 'SSEError';
    }
}

export type SSEStatus = 'CONNECTING' | 'OPEN' | 'CLOSED' | 'ERROR';

export interface RetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
    shouldRetry?: (error: SSEError, attemptCount: number) => boolean;
    // Added jitter configuration
    jitterFactor?: number;
}

export interface UseSSEOptions<T> {
    onMessage?: (event: MessageEvent) => void;
    onError?: (error: Event) => void;
    onOpen?: () => void;
    onClose?: () => void;
    withCredentials?: boolean;
    eventName?: string;
    parseData?: (data: string) => T;
    retry?: Partial<RetryConfig>;
}

export interface UseSSEResult<T> {
    status: SSEStatus;
    data: T | null;
    error: SSEError | null;
    close: () => void;
    retryCount: number;
    reconnect: () => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    shouldRetry: () => true,
    jitterFactor: 0.1,
};

export const useServerSentEvents = <T = unknown>(
    url: string,
    options: UseSSEOptions<T> = {}
): UseSSEResult<T> => {
    const [status, setStatus] = useState<SSEStatus>('CLOSED');
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<SSEError | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    const eventSourceRef = useRef<EventSource | null>(null);
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const isMounted = useRef(true);

    const retryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        ...options.retry,
    };

    const calculateRetryDelay = useCallback(
        (attempt: number) => {
            const baseDelay =
                retryConfig.initialDelayMs *
                Math.pow(retryConfig.backoffFactor, attempt);

            // Add jitter to prevent thundering herd
            // Especially relevant for us since people open many tabs in the app
            const jitter =
                baseDelay *
                (retryConfig.jitterFactor || 0) *
                (Math.random() * 2 - 1);

            return Math.min(baseDelay + jitter, retryConfig.maxDelayMs);
        },
        [retryConfig]
    );

    const close = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            setStatus('CLOSED');
            options.onClose?.();
        }
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
        }
    }, [options]);

    const attemptReconnect = useCallback(
        (attempt: number) => {
            if (!isMounted.current) return;

            if (attempt >= retryConfig.maxAttempts) {
                setStatus('ERROR');
                const error = new SSEError(
                    `Failed to connect after ${retryConfig.maxAttempts} attempts`,
                    'MAX_RETRY_EXCEEDED'
                );

                setError(error);
                return;
            }

            const delay = calculateRetryDelay(attempt);

            retryTimeoutRef.current = setTimeout(() => {
                if (!isMounted.current) return;
                setRetryCount(attempt + 1);
                createEventSource();
            }, delay);
        },
        [retryConfig.maxAttempts, calculateRetryDelay]
    );

    const createEventSource = useCallback(() => {
        // Close existing connection if any
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const sse = new EventSource(url.toString(), {
            withCredentials: options.withCredentials,
        });

        eventSourceRef.current = sse;
        setStatus('CONNECTING');
        return sse;
    }, [url, options.withCredentials]);

    const setupEventHandlers = useCallback(
        (sse: EventSource) => {
            const eventName = options.eventName || 'message';

            const messageHandler = (event: MessageEvent) => {
                if (!isMounted.current) return;

                try {
                    const parsedData = options.parseData
                        ? options.parseData(event.data)
                        : JSON.parse(event.data);

                    setData(parsedData as T);
                    options.onMessage?.(event);
                } catch (err) {
                    const error = new SSEError(
                        'Failed to parse event data',
                        'PARSE_ERROR'
                    );

                    setError(error);
                    options.onError?.(new ErrorEvent('error', { error }));
                }
            };

            const errorHandler = (event: Event) => {
                if (!isMounted.current) return;

                const currentError = new SSEError(
                    'EventSource failed',
                    'CONNECTION_ERROR'
                );

                setStatus('ERROR');
                setError(currentError);
                options.onError?.(event);

                if (retryConfig.shouldRetry?.(currentError, retryCount)) {
                    attemptReconnect(retryCount);
                }
            };

            const openHandler = () => {
                if (!isMounted.current) return;

                setStatus('OPEN');
                setError(null);
                setRetryCount(0);
                options.onOpen?.();
            };

            sse.addEventListener(eventName, messageHandler);
            sse.addEventListener('error', errorHandler);
            sse.addEventListener('open', openHandler);

            return () => {
                sse.removeEventListener(eventName, messageHandler);
                sse.removeEventListener('error', errorHandler);
                sse.removeEventListener('open', openHandler);
                sse.close();
            };
        },
        [
            options.eventName,
            options.parseData,
            options.onMessage,
            options.onError,
            options.onOpen,
            retryConfig,
            retryCount,
            attemptReconnect,
        ]
    );

    const reconnect = useCallback(() => {
        setRetryCount(0);
        const sse = createEventSource();

        setupEventHandlers(sse);
    }, [createEventSource, setupEventHandlers]);

    useEffect(() => {
        isMounted.current = true;

        const sse = createEventSource();
        const cleanup = setupEventHandlers(sse);

        return () => {
            isMounted.current = false;
            cleanup();
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
            }
        };
    }, [createEventSource, setupEventHandlers]);

    return {
        status,
        data,
        error,
        close,
        retryCount,
        reconnect,
    };
};

export default useServerSentEvents;