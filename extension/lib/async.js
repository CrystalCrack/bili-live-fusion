// Bound browser-owned promises as well as network requests: either can stay
// pending without rejecting when a document or extension worker is suspended.
export function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message); error.name = 'TimeoutError'; reject(error);
      }, milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}
