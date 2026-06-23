import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import UsageTrendChart from '../UsageTrendChart';

describe('UsageTrendChart', () => {
  it('renders an svg polyline for multiple points', () => {
    const { container } = render(
      <UsageTrendChart
        label="Daily token usage"
        points={[
          { date: '2026-06-01', totalTokens: 150 },
          { date: '2026-06-02', totalTokens: 320 },
        ]}
      />,
    );
    expect(container.querySelector('polyline')).toBeInTheDocument();
    expect(screen.getByLabelText('Daily token usage')).toBeInTheDocument();
  });

  it('renders an empty-state message when no points', () => {
    render(<UsageTrendChart label="Daily token usage" points={[]} />);
    expect(screen.getByText('Daily token usage')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
