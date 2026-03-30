interface Props {
  url: string;
  className?: string;
}

export default ({ url, className }: Props) => {
  return <img src={`asset://${url}`} className={className} />;
};
