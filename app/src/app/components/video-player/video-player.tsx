import ReactPlayer from 'react-player';

interface Props {
  url: string;
}

export default ({ url }: Props) => {
  let type = 'video/mp4';
  if (url.indexOf('.webm') > 0) {
    type = 'video/webm';
  }
  return (
    // TODO: FIX: this can't play MP4:
    // <ReactPlayer
    //   controls={true}
    //   // url={`https://asset.localhost/Users/dylan/Documents/Dropbox/Binderus/Project Binderus/QA - Testing/the_testerguy - 4_5/BUGS.mp4`}
    //   url={`asset:///Users/dylan/Documents/test.mp4`}
    // />
    <video width="95%" controls className="ml-8 mt-4 ">
      <source src={`asset://${url}`} type={type} />
      Your browser does not support the video tag.
    </video>
  );
};
