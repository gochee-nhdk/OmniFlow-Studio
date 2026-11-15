import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import POSPage from './pages/POSPage';
import SAPPage from './pages/SAPPage';
import HistoryPage from './pages/HistoryPage';
import ErrorCenterPage from './pages/ErrorCenterPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="pos" element={<POSPage />} />
        <Route path="sap" element={<SAPPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="errors" element={<ErrorCenterPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
