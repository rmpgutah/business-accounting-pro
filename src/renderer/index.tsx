import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { ToastProvider } from './components/ToastProvider';
import ShortcutCheatsheet from './components/ShortcutCheatsheet';
import IdleAutoLock from './components/IdleAutoLock';

// P3.26 + P3.29 + P5.57:
//   ToastProvider wraps the whole app so any descendant can
//   call useToast().
//   ShortcutCheatsheet is a self-mounting modal triggered
//   globally by the `?` key.
//   IdleAutoLock listens for inactivity and auto-logs-out after
//   the configured timeout (default 30 min, 0 = disabled).
const root = createRoot(document.getElementById('root')!);
root.render(
  <ToastProvider>
    <App />
    <ShortcutCheatsheet />
    <IdleAutoLock />
  </ToastProvider>
);
