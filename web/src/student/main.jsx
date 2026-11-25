import {createRoot} from 'react-dom/client';
import '../ui/tokens.css';
import '../ui/switch.css';
import '../ui/app.css';
import './student.css';
import {Providers} from '../ui/base.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<Providers><App /></Providers>);
