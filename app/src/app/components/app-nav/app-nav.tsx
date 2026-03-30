import { PageProps } from '../../types';

export default ({ onNav }: PageProps) => {
  return (
    <nav className="mt-4">
      <ul className="flex space-x-4">
        <li className="cursor-pointer" onClick={() => onNav ? onNav('/') : ''}>
          Main Page
        </li>
        <li className="cursor-pointer" onClick={() => onNav ? onNav('/test') : ''}>
          Test Page
        </li>
      </ul>
    </nav>
  );
};
