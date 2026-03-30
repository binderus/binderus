import AppNav from '../../components/app-nav/app-nav';
import { PageProps } from '../../types';
import { useFetch } from '../../utils/api-utils';

function TestPage({ onNav }: PageProps) {
  const { result, error, isLoading } = useFetch('https://dummyjson.com/products');
  console.log('result, error', result, error);

  if (error) return <div>failed to load</div>;
  if (isLoading) return <div>loading...</div>;

  const items = (result as any)?.products ?? [];
  return (
    <div>
      <AppNav onNav={onNav} />

      <div className="mt-4">
        {items.map((item: any) => {
          return <div key={item.id}>{item.title}</div>;
        })}
      </div>
    </div>
  );
}

export default TestPage;
