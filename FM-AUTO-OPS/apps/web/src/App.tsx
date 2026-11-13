import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import AutomationPage from './pages/AutomationPage';
import HistoryPage from './pages/HistoryPage';
import ErrorCenterPage from './pages/ErrorCenterPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="errors" element={<ErrorCenterPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
