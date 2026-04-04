import { render } from 'preact';
import { initSuperTokens } from './auth/supertokens.config';
import { App } from './app';
import './styles/terminal.css';

initSuperTokens();
render(<App />, document.getElementById('app')!);
