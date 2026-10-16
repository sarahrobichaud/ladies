import { Route, Routes } from "react-router";
import { ThemeToggle } from "./components/theme-toggle";
import { ChipLab } from "./features/felt/chip-lab";
import { ConfigPage } from "./pages/config-page";
import { TablePage } from "./pages/table-page";

export function App() {
  return (
    <>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<ConfigPage />} />
        <Route path="/table" element={<TablePage />} />
        <Route path="/chips" element={<ChipLab />} />
      </Routes>
    </>
  );
}
