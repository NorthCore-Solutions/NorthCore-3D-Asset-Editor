import 'three-bvh-csg';

declare module 'three-bvh-csg' {
  interface Evaluator {
    // In den Typdeklarationen von three-bvh-csg 0.0.18 noch nicht enthalten.
    useCDTClipping: boolean;
  }
}
