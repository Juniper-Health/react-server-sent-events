# useServerSentEvents

A React hook for handling Server-Sent Events (SSE) connections with automatic retry, error handling, and TypeScript support.

## Features

-   🔄 Automatic reconnection with exponential backoff
-   🎯 TypeScript support with generics for type-safe data handling
-   ⚡ Custom event handling
-   🔍 Comprehensive error handling
-   ⏱️ Configurable retry strategy with jitter
-   🧩 Custom data parsing support
-   🎮 Manual connection control

## Basic Usage

```typescript
import { useServerSentEvents } from 'shared/hooks/useServerSentEvents';

function MyComponent() {
  const { data, status, error } = useServerSentEvents<{ message: string }>(
    'http://api.example.com/events'
  );

  if (status === 'ERROR') {
    return <div>Error: {error?.message}</div>;
  }

  return (
    <div>
      <p>Status: {status}</p>
      {data && <p>Message: {data.message}</p>}
    </div>
  );
}
```

## API Reference

### Hook Parameters

```typescript
useServerSentEvents<T>(url: string, options?: UseSSEOptions<T>): UseSSEResult<T>
```

#### `url: string`

The URL of the SSE endpoint.

#### `options?: UseSSEOptions<T>`

| Option            | Type                            | Default      | Description                                  |
| ----------------- | ------------------------------- | ------------ | -------------------------------------------- |
| `onMessage`       | `(event: MessageEvent) => void` | `undefined`  | Callback for handling raw message events     |
| `onError`         | `(error: Event) => void`        | `undefined`  | Callback for handling error events           |
| `onOpen`          | `() => void`                    | `undefined`  | Callback when connection is established      |
| `onClose`         | `() => void`                    | `undefined`  | Callback when connection is closed           |
| `withCredentials` | `boolean`                       | `false`      | Enable credentials for cross-origin requests |
| `eventName`       | `string`                        | `'message'`  | Custom event name to listen for              |
| `parseData`       | `(data: string) => T`           | `JSON.parse` | Custom data parsing function                 |
| `retry`           | `RetryConfig`                   | See below    | Configuration for retry behavior             |

#### `RetryConfig`

```typescript
interface RetryConfig {
    maxAttempts: number; // Maximum number of retry attempts
    initialDelayMs: number; // Initial delay before first retry
    maxDelayMs: number; // Maximum delay between retries
    backoffFactor: number; // Exponential backoff multiplier
    jitterFactor?: number; // Random jitter factor (0-1)
    shouldRetry?: (error: SSEError, attemptCount: number) => boolean;
}
```

Default retry configuration:

```typescript
const DEFAULT_RETRY_CONFIG = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitterFactor: 0.1,
    shouldRetry: () => true,
};
```

### Return Value

The hook returns an object with the following properties:

```typescript
interface UseSSEResult<T> {
    status: 'CONNECTING' | 'OPEN' | 'CLOSED' | 'ERROR';
    data: T | null;
    error: SSEError | null;
    close: () => void;
    reconnect: () => void;
    retryCount: number;
}
```

| Property     | Type               | Description                                           |
| ------------ | ------------------ | ----------------------------------------------------- |
| `status`     | `SSEStatus`        | Current connection status                             |
| `data`       | `T \| null`        | Latest received data, parsed according to `parseData` |
| `error`      | `SSEError \| null` | Error object if an error occurred                     |
| `close`      | `() => void`       | Function to manually close the connection             |
| `reconnect`  | `() => void`       | Function to manually trigger reconnection             |
| `retryCount` | `number`           | Number of retry attempts made                         |

## Advanced Usage Examples

### Custom Event Handling

```typescript
const { data } = useServerSentEvents<UpdateData>(
    'http://api.example.com/updates',
    {
        eventName: 'update',
        onMessage: (event) => {
            console.log('Raw event:', event);
        },
    }
);
```

### Custom Data Parsing

```typescript
const { data } = useServerSentEvents<UserStatus>(
    'http://api.example.com/status',
    {
        parseData: (data) => {
            const parsed = JSON.parse(data);
            return {
                ...parsed,
                lastUpdate: new Date(parsed.timestamp),
            };
        },
    }
);
```

### Custom Retry Strategy

```typescript
const { status, error } = useServerSentEvents('http://api.example.com/events', {
    retry: {
        maxAttempts: 5,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffFactor: 1.5,
        shouldRetry: (error, attemptCount) => {
            // Don't retry on 404 errors
            if (error.code === 'NOT_FOUND') return false;
            return attemptCount < 5;
        },
    },
});
```

### Manual Connection Control

```typescript
function StatusMonitor() {
  const { status, close, reconnect } = useServerSentEvents(
    'http://api.example.com/status'
  );

  return (
    <div>
      <p>Connection: {status}</p>
      <button onClick={close}>Stop Monitoring</button>
      <button onClick={reconnect}>Reconnect</button>
    </div>
  );
}
```

## Error Handling

The hook provides detailed error information through the `SSEError` class:

```typescript
class SSEError extends Error {
    code?: string;
}
```

Common error codes:

-   `CONNECTION_ERROR`: General connection failure
-   `PARSE_ERROR`: Failed to parse incoming data
-   `MAX_RETRY_EXCEEDED`: Maximum retry attempts reached

## Best Practices

1. **Type Safety**: Always provide a type parameter for better type inference:

    ```typescript
    interface EventData {
        type: string;
        payload: unknown;
    }

    const { data } = useServerSentEvents<EventData>(url);
    ```

2. **Error Handling**: Always handle error states in your UI:

    ```typescript
    if (status === 'ERROR') {
      return <ErrorComponent error={error} onRetry={reconnect} />;
    }
    ```

3. **Cleanup**: The hook automatically handles cleanup, but make sure to call `close()` when manually ending connections.

4. **Reconnection Strategy**: Configure the retry strategy based on your needs:
    - Increase `maxAttempts` for critical connections
    - Adjust `jitterFactor` to prevent thundering herd problems
    - Use `shouldRetry` to implement custom retry logic

## TypeScript Support

The hook is fully typed and supports generic type parameters for the event data:

```typescript
interface UserData {
    firstName: string;
    lastName: string;
    email: string;
}
const { data } = useServerSentEvents<UserData>('http://api.example.com/events');
```