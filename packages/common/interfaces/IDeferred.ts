export interface IDeferred {
  promise: Promise<void>;
  resolve: () => void;
}
