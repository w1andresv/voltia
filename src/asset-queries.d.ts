declare module "*.css?url" {
  const href: string;
  export default href;
}

declare module "*.html?raw" {
  const source: string;
  export default source;
}
