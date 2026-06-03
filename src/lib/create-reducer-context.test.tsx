// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createReducerContext } from "./create-reducer-context";

interface CountState {
  count: number;
}

type CountAction = { type: "increment" };

/**
 * Minimal reducer used to exercise the factory in tests.
 */
function countReducer(state: CountState, action: CountAction): CountState {
  switch (action.type) {
    case "increment":
      return { count: state.count + 1 };
    default:
      return state;
  }
}

describe("createReducerContext", () => {
  it("seeds initial state from provider props and updates it via dispatch", async () => {
    // Given a context whose provider seeds the count to 5
    const [Provider, useCountState, useCountDispatch] = createReducerContext(
      countReducer,
      { count: 0 },
    );

    function Counter() {
      const { count } = useCountState();
      const dispatch = useCountDispatch();
      return (
        <button type="button" onClick={() => dispatch({ type: "increment" })}>
          count: {count}
        </button>
      );
    }

    render(
      <Provider count={5}>
        <Counter />
      </Provider>,
    );

    // Then the seeded value is shown (overriding the factory's initial state)
    expect(screen.getByRole("button")).toHaveTextContent("count: 5");

    // When the consumer dispatches an action
    await userEvent.click(screen.getByRole("button"));

    // Then the state updates
    expect(screen.getByRole("button")).toHaveTextContent("count: 6");
  });

  it("throws a clear error when the state hook is used outside its provider", () => {
    // Given a consumer rendered with no provider above it
    const [, useCountState] = createReducerContext(countReducer, { count: 0 });

    function Orphan() {
      useCountState();
      return null;
    }

    // Then reading the hook throws a clear, provider-naming error
    expect(() => render(<Orphan />)).toThrow(/within its .*Provider/i);
  });
});
