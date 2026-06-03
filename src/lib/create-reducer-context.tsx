"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useReducer,
} from "react";

/**
 * Sentinel marking "no provider above". Using a unique symbol (rather than
 * `null`/`undefined`) lets the missing-provider guard fire even when the real
 * state value is itself falsy or null.
 */
const MISSING = Symbol("createReducerContext.missing");

/**
 * Build a typed reducer-backed context. Returns a `[Provider, useState,
 * useDispatch]` tuple. The Provider seeds its reducer's initial state by merging
 * any state-shaped props over `initialState` (e.g. `<Provider count={5}>`), per
 * the repo's provider-props pattern. Each hook throws a clear error when used
 * outside the Provider.
 * @param reducer - Pure reducer driving the context state.
 * @param initialState - Default state, overridable per-mount via Provider props.
 * @returns A tuple of the Provider component and the state/dispatch hooks.
 */
export function createReducerContext<State extends object, Action>(
  reducer: (state: State, action: Action) => State,
  initialState: State,
) {
  const StateContext = createContext<State | typeof MISSING>(MISSING);
  const DispatchContext = createContext<Dispatch<Action> | typeof MISSING>(
    MISSING,
  );

  /**
   * Provider that owns the reducer state. State-shaped props override the
   * factory's `initialState` at mount time.
   */
  function Provider({
    children,
    ...seed
  }: { children: ReactNode } & Partial<State>) {
    const [state, dispatch] = useReducer(reducer, {
      ...initialState,
      ...(seed as Partial<State>),
    });

    return (
      <StateContext.Provider value={state}>
        <DispatchContext.Provider value={dispatch}>
          {children}
        </DispatchContext.Provider>
      </StateContext.Provider>
    );
  }

  /**
   * Read the current context state. Throws if used outside the Provider.
   */
  function useReducerState(): State {
    const state = useContext(StateContext);
    if (state === MISSING) {
      throw new Error(
        "useReducerState must be used within its createReducerContext Provider",
      );
    }
    return state;
  }

  /**
   * Get the context dispatch function. Throws if used outside the Provider.
   */
  function useReducerDispatch(): Dispatch<Action> {
    const dispatch = useContext(DispatchContext);
    if (dispatch === MISSING) {
      throw new Error(
        "useReducerDispatch must be used within its createReducerContext Provider",
      );
    }
    return dispatch;
  }

  return [Provider, useReducerState, useReducerDispatch] as const;
}
