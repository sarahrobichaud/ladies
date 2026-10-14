import { Route, Routes } from 'react-router';
import { ThemeToggle } from './components/theme-toggle';
import { ConfigPage } from './pages/config-page';
import { TablePage } from './pages/table-page';

export function App() {
  return (
    <>
      <ThemeToggle />
      <Routes>
      <Route path="/" element={<ConfigPage />} />
      <Route path="/table" element={<TablePage />} />
    </Routes>
  </>
  );
}
