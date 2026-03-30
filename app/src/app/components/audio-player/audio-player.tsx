import ReactPlayer from 'react-player';

interface Props {
  url: string;
}

export default ({ url }: Props) => {
  return (
    <audio controls className="ml-6 mt-10 w-1/2">
      <source src={`asset://${url}`} type="audio/mpeg" />
      Your browser does not support the audio element.
    </audio>
  );
};
