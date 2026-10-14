import { Component, type ReactNode } from 'react';

/** Zamiast białego ekranu: komunikat i przeładowanie (dane są w chmurze / w przeglądarce, nic nie ginie). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="card auth-card">
          <h1>Coś poszło nie tak</h1>
          <p className="muted">Ekran nie mógł się wyświetlić. Twoje dane są bezpieczne — spróbuj odświeżyć.</p>
          <p className="muted small">{this.state.error.message}</p>
          <button className="btn btn-primary btn-block" onClick={() => location.reload()}>
            Odśwież
          </button>
        </div>
      </div>
    );
  }
}
