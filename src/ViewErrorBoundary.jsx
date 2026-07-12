import React from 'react';

export default class ViewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('BuildBook view failed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel view-error" role="alert">
        <h1>This view could not be displayed</h1>
        <p>Your saved workspace data has not been removed.</p>
        <details><summary>Technical details</summary><pre>{String(this.state.error?.message || this.state.error)}</pre></details>
        <button onClick={() => window.location.reload()}>Reload BuildBook</button>
      </section>
    );
  }
}
