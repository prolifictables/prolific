import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './lib/auth-store';
import LoginScreen from './components/pos/LoginScreen';
import CashierScreenLayout from './components/pos/CashierScreenLayout';
import CustomerDisplayApp from './components/customer/CustomerDisplayApp';

function RequireAuth({ children }: { children: JSX.Element }) {
  const employee = useAuthStore((s) => s.employee);
  if (!employee) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireGuest({ children }: { children: JSX.Element }) {
  const employee = useAuthStore((s) => s.employee);
  if (employee) {
    return <Navigate to="/pos" replace />;
  }
  return children;
}

function RootRedirect() {
  const employee = useAuthStore((s) => s.employee);
  return <Navigate to={employee ? '/pos' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RequireGuest>
            <LoginScreen />
          </RequireGuest>
        }
      />
      <Route
        path="/pos"
        element={
          <RequireAuth>
            <CashierScreenLayout />
          </RequireAuth>
        }
      />
      <Route path="/customer-display" element={<CustomerDisplayApp />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
