export type Events = {
  title: string;
  status: string;
  summary: string;
  event?: string[];
  href?: string; // page with the full details
};

export const events: Events[] = [
  {
    title: 'Processing Community Day in İzmir',
    status: 'Upcoming',
    href: '/events/pcd-2026/',
    summary:
      'A community-led gathering celebrating creative coding, digital art, and the open-source ecosystem on the 26th of October 2026.',
  }
];
