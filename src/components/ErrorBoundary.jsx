import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error){ return { error }; }
  componentDidCatch(error, info){ console.error('UI crash:', error, info); }
  render(){
    if (this.state.error) {
      return (
        <div style={{padding:16,fontFamily:'monospace'}}>
          <h2>Something broke.</h2>
          <pre>{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
