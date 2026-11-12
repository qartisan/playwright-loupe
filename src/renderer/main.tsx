import { render } from 'preact';
import { App } from './components/App.js';
import { parseReport, parseSettings } from './data.js';
import { initFilters } from './filters/store.js';
import { loadHistory } from './history.js';
import { initTheme } from './theme.js';
import './styles.css';

const settings = parseSettings(document.getElementById('loupe-settings')?.textContent);
document.title = settings.title;
initTheme(settings.theme);

const result = parseReport(document.getElementById('loupe-data')?.textContent);
const root = document.getElementById('app') ?? document.body;
// Read once at load; null without history, and then no history zone anywhere.
const history = result.ok ? loadHistory(document.getElementById('loupe-history')?.textContent, result.report) : null;
if (result.ok) initFilters(result.report, history);

render(
  result.ok ? (
    <App report={result.report} settings={settings} history={history} />
  ) : (
    <main class="load-error">
      <div role="alert">
        <h1>Loupe could not open this report</h1>
        <p>{result.message}</p>
      </div>
    </main>
  ),
  root,
);
