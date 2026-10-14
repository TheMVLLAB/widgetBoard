interface D1Database {
  prepare(query:string):D1PreparedStatement;
  batch<T=Record<string,unknown>>(statements:D1PreparedStatement[]):Promise<{results:T[]}[]>;
}
interface D1PreparedStatement {
  bind(...params:unknown[]):D1PreparedStatement;
  first<T=Record<string,unknown>>():Promise<T|null>;
  all<T=Record<string,unknown>>():Promise<{results:T[]}>;
  run():Promise<unknown>;
}
