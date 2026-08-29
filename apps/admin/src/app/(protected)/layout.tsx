import AdminLayoutClient from './admin-layout-client';
import { ToastProvider } from '@/components/ui/Toast';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <AdminLayoutClient>{children}</AdminLayoutClient>
    </ToastProvider>
  );
}
