import LoginClient from './login-client';
import { Suspense } from 'react';

export default function LoginPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || '';
  return (
    <Suspense fallback={null}>
      <LoginClient apiUrl={apiUrl} socketUrl={socketUrl} />
    </Suspense>
  );
}
