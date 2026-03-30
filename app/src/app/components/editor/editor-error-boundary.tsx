/**
 * Description: React error boundary for the Milkdown editor. Catches parse errors
 *   (e.g. "Create prosemirror node from remark failed") and renders a fallback UI.
 * Requirements: React 18+
 * Inputs: children (editor component), fallback render prop receiving the error
 * Outputs: Either children on success, or fallback UI on error
 */
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // Reset error when children change (new file opened)
  componentDidUpdate(prevProps: Props) {
    if (prevProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}
