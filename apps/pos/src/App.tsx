import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './lib/auth-store';
import LoginScreen from './components/pos/LoginScreen';
import CashierScreenLayout from './components/pos/CashierScreenLayout';
import CustomerDisplayApp from './components/customer/CustomerDisplayApp';

// NOTE: ApiWakeOverlay is INTENTIONALLY NOT mounted on POS App.tsx.
// User explicitly requested: "the server waking up modal does not have to show
// on the POS section. it is making everything look tiring."
//
// Instead of a blocking full-screen modal, POS handles Render cold-start via:
//   1. LoginScreen.preWakeApi() fires silently in the background on mount.
//   2. LoginScreen renders its own inline NON-BLOCKING "Checking server…"
//      amber SYNCHRONIZING pill (with elapsed/ETA estimate) under the
//      connection chip, so cashiers can type PINs UNINTERRUPTED.
//   3. If cashier taps Sign In while the API is still cold, guardedFetch
//      inside pinLogin() still calls waitForApiWake() in the background —
//      "Verifying PIN…" button spinner stays active, NO blocking modal,
//      and login succeeds automatically once Render finishes booting.
//   4. Once inside CashierScreenLayout (authenticated), all guardedFetches
//      for menu/bootstrap/sync also wake transparently in background with a
//      spinner on the individual component/button — never a page-level modal.
//
// (If we ever want the modal back, import ApiWakeOverlay and mount it here as
// the first child of <> — the file still exists.)

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
    <>
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
    </>
  );
}
