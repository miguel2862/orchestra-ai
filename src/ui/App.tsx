import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import NewProject from "./pages/NewProject";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Settings from "./pages/Settings";
import Usage from "./pages/Usage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/new" replace />} />
        <Route path="/new" element={<NewProject />} />
        <Route path="/project/:id" element={<Dashboard />} />
        <Route path="/history" element={<History />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
