export class Unreachable extends Error {
  constructor(value: never) {
    super(value);
    console.log(`this is unreachable ${value}`);
  }
}
