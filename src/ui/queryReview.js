/** Imported SQL stays visible as text until the existing Run → Apply review. */
export function paintQueryReview(container, query, onReview) {
  const box = document.createElement('div');
  box.className = 'tile-error tile-query-review';
  const name = document.createElement('div');
  name.className = 'tile-error-title';
  name.textContent = query.name;
  const explanation = document.createElement('div');
  explanation.className = 'tile-error-msg';
  explanation.textContent = 'This query came from an imported file and has not run yet.';
  const sql = document.createElement('pre');
  sql.className = 'tile-query-sql';
  sql.tabIndex = 0;
  sql.setAttribute('aria-label', 'Imported SQL query');
  sql.textContent = query.sql;
  const review = document.createElement('button');
  review.type = 'button';
  review.textContent = 'Review query';
  review.addEventListener('click', onReview);
  box.append(name, explanation, sql, review);
  container.replaceChildren(box);
}
