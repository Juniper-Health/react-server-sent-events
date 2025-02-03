/* eslint-disable @typescript-eslint/no-explicit-any */
import { it } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useServerSentEvents } from 'shared/hooks/useServerSentEvents';

// Mock EventSource
class MockEventSource {
    private listeners: Record<string, ((event: any) => void)[]> = {};
    public url: string;
    public withCredentials?: boolean;

    constructor(url: string, options?: { withCredentials?: boolean }) {
        this.url = url;
        this.withCredentials = options?.withCredentials;
    }

    addEventListener(type: string, listener: (event: any) => void) {
        if (!this.listeners[type]) {
            this.listeners[type] = [];
        }
        this.listeners[type].push(listener);
    }

    removeEventListener(type: string, listener: (event: any) => void) {
        if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(
                (l) => l !== listener
            );
        }
    }

    close() {
        // Cleanup listeners
        this.listeners = {};
    }

    // Test helper methods
    emit(type: string, event: any) {
        if (this.listeners[type]) {
            this.listeners[type].forEach((listener) => listener(event));
        }
    }
}

// Setup global mocks
global.EventSource = MockEventSource as any;

// Test utilities
const createMessageEvent = (data: any) => ({
    data: JSON.stringify(data),
    type: 'message',
    lastEventId: '',
    origin: 'http://localhost',
});

const createErrorEvent = () => ({
    type: 'error',
    error: new Error('EventSource error'),
});

describe('useServerSentEvents', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    describe('Connection Lifecycle', () => {
        it('should initialize with CONNECTING status', () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            expect(result.current.status).toBe('CONNECTING');
        });

        it('should update status to OPEN when connection is established', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('open', {});
            });

            expect(result.current.status).toBe('OPEN');
        });

        it('should handle connection close', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            await act(async () => {
                result.current.close();
            });

            expect(result.current.status).toBe('CLOSED');
        });
    });

    describe('Data Handling', () => {
        it('should handle incoming messages', async () => {
            const testData = { message: 'test' };
            const { result } = renderHook(() =>
                useServerSentEvents<typeof testData>('http://test.com/events')
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('message', createMessageEvent(testData));
            });

            expect(result.current.data).toEqual(testData);
        });

        it('should use custom parser when provided', async () => {
            const testData = 'test-data';
            const parseData = (data: string) => ({ parsed: data });

            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events', { parseData })
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('message', createMessageEvent(testData));
            });

            expect(result.current.data).toEqual({ parsed: testData });
        });

        it('should handle custom event names', async () => {
            const testData = { message: 'test' };
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events', {
                    eventName: 'custom-event',
                })
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('custom-event', createMessageEvent(testData));
            });

            expect(result.current.data).toEqual(testData);
        });
    });

    describe('Error Handling', () => {
        it('should handle connection errors', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
            });

            expect(result.current.status).toBe('ERROR');
            expect(result.current.error).toBeTruthy();
            expect(result.current.error?.code).toBe('CONNECTION_ERROR');
        });

        it('should handle parsing errors', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('message', { data: 'invalid-json' });
            });

            expect(result.current.error?.code).toBe('PARSE_ERROR');
        });
    });

    describe('Retry Mechanism', () => {
        it('should retry connection on error with exponential backoff', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events', {
                    retry: {
                        maxAttempts: 3,
                        initialDelayMs: 1000,
                        backoffFactor: 2,
                    },
                })
            );

            // Trigger first error
            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
            });

            // First retry
            await act(async () => {
                jest.advanceTimersByTime(1000);
            });
            expect(result.current.retryCount).toBe(1);

            // Second retry
            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
                jest.advanceTimersByTime(2000);
            });
            expect(result.current.retryCount).toBe(2);
        });

        it('should stop retrying after max attempts', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events', {
                    retry: {
                        maxAttempts: 2,
                        initialDelayMs: 1000,
                        backoffFactor: 2,
                    },
                })
            );

            // Trigger errors and advance time for retries
            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
                jest.advanceTimersByTime(1000);
                eventSource.emit('error', createErrorEvent());
                jest.advanceTimersByTime(2000);
            });

            expect(result.current.status).toBe('ERROR');
            expect(result.current.error?.code).toBe('MAX_RETRY_EXCEEDED');
        });

        it('should respect custom shouldRetry configuration', async () => {
            const shouldRetry = jest.fn().mockReturnValue(false);

            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events', {
                    retry: {
                        shouldRetry,
                        maxAttempts: 3,
                        initialDelayMs: 1000,
                    },
                })
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
            });

            expect(shouldRetry).toHaveBeenCalled();
            expect(result.current.retryCount).toBe(0);
        });
    });

    describe('Cleanup', () => {
        it('should cleanup resources on unmount', () => {
            const { unmount } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            const eventSource = (EventSource as any).mock.instances[0];
            const closeSpy = jest.spyOn(eventSource, 'close');

            unmount();

            expect(closeSpy).toHaveBeenCalled();
        });

        it('should cleanup retry timeouts on unmount', async () => {
            const { result, unmount } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
            });

            unmount();

            // Advance time to ensure no more retries occur
            await act(async () => {
                jest.advanceTimersByTime(10000);
            });

            expect(result.current.status).toBe('ERROR');
        });
    });

    describe('Manual Reconnection', () => {
        it('should allow manual reconnection', async () => {
            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events')
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
            });

            expect(result.current.status).toBe('ERROR');

            await act(async () => {
                result.current.reconnect();
            });

            expect(result.current.status).toBe('CONNECTING');
            expect(result.current.retryCount).toBe(0);
        });
    });

    describe('Callbacks', () => {
        it('should call onMessage callback', async () => {
            const onMessage = jest.fn();
            const testData = { message: 'test' };

            renderHook(() =>
                useServerSentEvents('http://test.com/events', { onMessage })
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];
                const event = createMessageEvent(testData);

                eventSource.emit('message', event);
            });

            expect(onMessage).toHaveBeenCalled();
        });

        it('should call onError callback', async () => {
            const onError = jest.fn();

            renderHook(() =>
                useServerSentEvents('http://test.com/events', { onError })
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('error', createErrorEvent());
            });

            expect(onError).toHaveBeenCalled();
        });

        it('should call onOpen callback', async () => {
            const onOpen = jest.fn();

            renderHook(() =>
                useServerSentEvents('http://test.com/events', { onOpen })
            );

            await act(async () => {
                const eventSource = (EventSource as any).mock.instances[0];

                eventSource.emit('open', {});
            });

            expect(onOpen).toHaveBeenCalled();
        });

        it('should call onClose callback', async () => {
            const onClose = jest.fn();

            const { result } = renderHook(() =>
                useServerSentEvents('http://test.com/events', { onClose })
            );

            await act(async () => {
                result.current.close();
            });

            expect(onClose).toHaveBeenCalled();
        });
    });
});