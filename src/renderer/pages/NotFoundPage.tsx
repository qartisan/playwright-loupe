import { hrefTo } from '../navigation.js';

export function NotFoundPage({ message = 'This page does not exist in this report.' }: { message?: string }) {
  return (
    <div class="page">
      <h1>Not found</h1>
      <p>{message}</p>
      <p>
        <a href={hrefTo({ page: 'dashboard' })}>Back to the dashboard</a>
      </p>
    </div>
  );
}
