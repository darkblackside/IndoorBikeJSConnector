# Rendering / game engine

Reserved for the game engine integration (scenes, sprites, input, camera).

Rule: the engine only **renders** and collects **input**. Game state and rules live in
`@indoor-bike/game-core` (e.g. `CityWorld`, `rampStateAt`), so the same code can run on the Node
multiplayer server. An engine scene reads a `CityWorld` each frame the way
`src/zombie-ramp/cityRenderer.ts` (plain canvas 2D) does today, and replaces it when it is ready.
