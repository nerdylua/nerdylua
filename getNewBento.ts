import puppeteer from "puppeteer-core";

type BentoConfig = {
  name: string;
  githubUsername: string;
  twitterUsername: string;
  linkedinUsername: string;
  imageUrl: string;
  portfolioUrl: string;
};

type ContributionDay = {
  date: string;
  contributionCount: number;
};

type UserStats = {
  Followers: number;
  Repositories: number;
  Organizations: number;
  "Pull Requests": number;
  Issues: number;
  Commits: number;
  Sponsors: number;
  "Contributed To": number;
  "Star Earned": number;
};

type ContributionStats = {
  totalContributions: number;
  firstDateofContribution: string | null;
  longestStreak: number;
  longestStreakStartDate: string | null;
  longestStreakEndDate: string | null;
  currentStreak: number;
  currentStreakStartDate: string | null;
  currentStreakEndDate: string | null;
};

const config: BentoConfig = JSON.parse("{"name":"Nihaal","githubUsername":"nerdylua","twitterUsername":"nerdylua","linkedinUsername":"nihaal-sp","imageUrl":"https://avatars.githubusercontent.com/u/150607136?v=4","portfolioUrl":""}") as BentoConfig;
const outputPath = "opbento.png";
const githubToken =
  process.env.OPBENTO_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const executablePath =
  process.env.CHROME_PATH ||
  process.env.CHROME_EXECUTABLE_PATH ||
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "";

if (!githubToken) {
  throw new Error(
    "Missing OPBENTO_GITHUB_TOKEN or GITHUB_TOKEN in the environment.",
  );
}

if (!executablePath) {
  throw new Error(
    "Missing CHROME_PATH, CHROME_EXECUTABLE_PATH, or PUPPETEER_EXECUTABLE_PATH in the environment.",
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeUrl(value: string) {
  return escapeHtml(value);
}

async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}`);
  }

  if (result.errors?.length) {
    throw new Error(result.errors.map((entry) => entry.message).join("; "));
  }

  if (!result.data) {
    throw new Error("GitHub API returned no data.");
  }

  return result.data;
}

async function fetchContributionYears(username: string): Promise<number[]> {
  const data = await githubGraphql<{
    user: { contributionsCollection: { contributionYears: number[] } } | null;
  }>(
    `
      query ($user: String!) {
        user(login: $user) {
          contributionsCollection {
            contributionYears
          }
        }
      }
    `,
    { user: username },
  );

  if (!data.user) {
    throw new Error("GitHub user not found");
  }

  return data.user.contributionsCollection.contributionYears;
}

async function fetchYearContributions(
  username: string,
  year: number,
): Promise<ContributionDay[]> {
  const start = `${year}-01-01T00:00:00Z`;
  const end = `${year}-12-31T23:59:59Z`;

  const data = await githubGraphql<{
    user:
      | {
          contributionsCollection: {
            contributionCalendar: {
              weeks: { contributionDays: ContributionDay[] }[];
            };
          };
        }
      | null;
  }>(
    `
      query ($user: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $user) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `,
    { user: username, from: start, to: end },
  );

  if (!data.user) {
    throw new Error("GitHub user not found");
  }

  return data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    (week) => week.contributionDays,
  );
}

async function fetchUserStats(username: string): Promise<UserStats> {
  const data = await githubGraphql<{
    user:
      | {
          followers: { totalCount: number };
          repositoriesWithStargazerCount: {
            totalCount: number;
            nodes: { stargazerCount: number }[];
          };
          organizations: { totalCount: number };
          pullRequests: { totalCount: number };
          issues: { totalCount: number };
          contributionsCollection: { totalCommitContributions: number };
          sponsors: { totalCount: number };
          repositoriesContributedTo: { totalCount: number };
        }
      | null;
  }>(
    `
      query ($username: String!) {
        user(login: $username) {
          followers {
            totalCount
          }
          contributionsCollection {
            totalCommitContributions
          }
          repositoriesContributedTo(
            first: 1
            contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
          ) {
            totalCount
          }
          pullRequests(first: 1) {
            totalCount
          }
          issues(first: 1) {
            totalCount
          }
          organizations(first: 1) {
            totalCount
          }
          sponsors {
            totalCount
          }
          repositoriesWithStargazerCount: repositories(
            first: 100
            privacy: PUBLIC
            ownerAffiliations: OWNER
            orderBy: {field: STARGAZERS, direction: DESC}
          ) {
            totalCount
            nodes {
              stargazerCount
            }
          }
        }
      }
    `,
    { username },
  );

  if (!data.user) {
    throw new Error("GitHub user not found");
  }

  return {
    Followers: data.user.followers.totalCount,
    Repositories: data.user.repositoriesWithStargazerCount.totalCount,
    Organizations: data.user.organizations.totalCount,
    "Pull Requests": data.user.pullRequests.totalCount,
    Issues: data.user.issues.totalCount,
    Commits: data.user.contributionsCollection.totalCommitContributions,
    Sponsors: data.user.sponsors.totalCount,
    "Contributed To": data.user.repositoriesContributedTo.totalCount,
    "Star Earned": data.user.repositoriesWithStargazerCount.nodes.reduce(
      (accumulator, repository) => accumulator + repository.stargazerCount,
      0,
    ),
  };
}

function calculateTotalContributions(contributionDays: ContributionDay[]) {
  const total = contributionDays.reduce(
    (sum, day) => sum + day.contributionCount,
    0,
  );
  const firstContributionDate =
    contributionDays.find((day) => day.contributionCount > 0)?.date || null;

  return { total, firstContributionDate };
}

function calculateLongestStreak(contributionDays: ContributionDay[]) {
  let longestStreak = 0;
  let tempStreak = 0;
  let lastDate: Date | null = null;
  let streakStartDate: string | null = null;
  let streakEndDate: string | null = null;
  let longestStartDate: string | null = null;
  let longestEndDate: string | null = null;

  for (const day of contributionDays) {
    const currentDate = new Date(day.date);

    if (day.contributionCount > 0) {
      if (!tempStreak) {
        streakStartDate = day.date;
      }

      if (lastDate) {
        const dayDifference =
          (currentDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

        if (dayDifference === 1) {
          tempStreak++;
          streakEndDate = day.date;
        } else {
          if (tempStreak > longestStreak) {
            longestStreak = tempStreak;
            longestStartDate = streakStartDate;
            longestEndDate = streakEndDate;
          }

          tempStreak = 1;
          streakStartDate = day.date;
          streakEndDate = day.date;
        }
      } else {
        tempStreak = 1;
        streakStartDate = day.date;
        streakEndDate = day.date;
      }

      lastDate = currentDate;
    } else {
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStartDate = streakStartDate;
        longestEndDate = streakEndDate;
      }

      tempStreak = 0;
    }
  }

  if (tempStreak > longestStreak) {
    longestStreak = tempStreak;
    longestStartDate = streakStartDate;
    longestEndDate = streakEndDate;
  }

  return {
    longestStreak,
    startDate: longestStartDate,
    endDate: longestEndDate,
  };
}

function calculateCurrentStreak(contributionDays: ContributionDay[]) {
  let currentStreak = 0;
  let streakStartDate: string | null = null;
  let streakEndDate: string | null = null;
  let lastDate = new Date();

  for (let index = contributionDays.length - 1; index >= 0; index -= 1) {
    const currentDate = new Date(contributionDays[index].date);
    const dayDifference =
      (lastDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24);

    if (contributionDays[index].contributionCount > 0 && dayDifference <= 1) {
      if (!currentStreak) {
        streakStartDate = contributionDays[index].date;
      }

      currentStreak++;
      streakEndDate = contributionDays[index].date;
      lastDate = currentDate;
    } else if (dayDifference > 1) {
      break;
    }
  }

  return {
    currentStreak,
    startDate: streakStartDate,
    endDate: streakEndDate,
  };
}

function formatDate(dateString: string | null): string | null {
  if (!dateString) {
    return null;
  }

  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };

  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }

  return date.toLocaleDateString("en-US", options);
}

async function fetchContributionStats(
  username: string,
): Promise<ContributionStats> {
  const contributionYears = await fetchContributionYears(username);
  let allContributionDays: ContributionDay[] = [];

  for (const year of contributionYears) {
    const yearContributions = await fetchYearContributions(username, year);
    allContributionDays = allContributionDays.concat(yearContributions);
  }

  allContributionDays.sort(
    (left, right) =>
      new Date(left.date).getTime() - new Date(right.date).getTime(),
  );

  const { total, firstContributionDate } =
    calculateTotalContributions(allContributionDays);
  const longest = calculateLongestStreak(allContributionDays);
  const current = calculateCurrentStreak(allContributionDays);

  return {
    totalContributions: total,
    firstDateofContribution: formatDate(firstContributionDate),
    longestStreak: longest.longestStreak,
    longestStreakStartDate: formatDate(longest.startDate),
    longestStreakEndDate: formatDate(longest.endDate),
    currentStreak: current.currentStreak,
    currentStreakStartDate: formatDate(current.startDate),
    currentStreakEndDate: formatDate(current.endDate),
  };
}

function generateContributionGraph(contributionDays: ContributionDay[]) {
  const dayWidth = 13;
  const dayHeight = 13;
  const dayPadding = 2;
  const weekPadding = 5;
  const svgPadding = 0;

  const weeks: ContributionDay[][] = [];
  let currentWeek: ContributionDay[] = [];

  for (let index = 0; index < contributionDays.length; index += 1) {
    currentWeek.push(contributionDays[index]);

    if (currentWeek.length === 7 || index === contributionDays.length - 1) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  const numWeeks = weeks.length;
  const svgHeight = 7 * (dayHeight + dayPadding) + 2 * svgPadding;
  const svgWidth = numWeeks * (dayWidth + weekPadding) + 2 * svgPadding;

  const getFillColor = (count: number) => {
    if (count === 0) return "#191919";
    if (count <= 5) return "#14532D";
    if (count <= 10) return "#1E7A1E";
    if (count <= 20) return "#28A745";
    return "#00ef57";
  };

  return `
    <svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      ${weeks
        .map((week, weekIndex) =>
          week
            .map((day, dayIndex) => {
              const x = svgPadding + weekIndex * (dayWidth + weekPadding);
              const y = svgPadding + dayIndex * (dayHeight + dayPadding);
              return `<rect x="${x}" y="${y}" width="${dayWidth}" height="${dayHeight}" fill="${getFillColor(day.contributionCount)}" strokeWidth="0.5" rx="2" ry="2" />`;
            })
            .join(""),
        )
        .join("")}
    </svg>
  `;
}

function renderHtml(
  config: BentoConfig,
  userStats: UserStats,
  contributionStats: ContributionStats,
  graphSvg: string,
) {
  const fallbackImage =
    "https://images.unsplash.com/photo-1541701494587-cb58502866ab?q=80&w=2070&auto=format&fit=crop";
  const imageUrl = config.imageUrl || fallbackImage;
  const portfolioDisplay = config.portfolioUrl.startsWith("https://")
    ? config.portfolioUrl.replace("https://", "")
    : config.portfolioUrl;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bento Grid</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>

  <body class="bg-neutral-950 text-white font-['Space_Grotesk']">
    <div class="max-w-5xl mx-auto">
      <div
        class="p-1 grid grid-cols-1 md:grid-cols-4 gap-4 max-w-5xl mt-4 w-full mx-auto relative"
      >
        <div class="text-white py-6 px-8 rounded-lg bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-600 col-span-1 row-span-1 min-h-32">
          <p class="text-xl">Hey I'm</p>
          <h2 class="text-4xl font-bold mb-2 capitalize">${escapeHtml(config.name || "User")}</h2>
        </div>

        <div class="bg-muted h-80 overflow-hidden rounded-lg col-span-2 row-span-2 flex items-center justify-center">
          <img
            src="${escapeUrl(imageUrl)}"
            alt="${escapeHtml(config.name || "User")}"
            class="w-full h-full hover:scale-110 duration-500 transition-all ease object-cover"
          />
        </div>

        <a
          href="${escapeUrl(config.twitterUsername ? `https://x.com/${encodeURIComponent(config.twitterUsername)}` : "#")}"
          class="bg-gradient-to-br from-black to-blue-500 p-4 relative rounded-lg overflow-hidden col-span-1 row-span-1 min-h-[150px]"
        >
          <i
            data-lucide="twitter"
            class="absolute glow -top-3 -left-4 w-24 h-24 text-[#29BEF0]"
            strokeWidth="1"
          ></i>
          <p class="z-20 absolute bottom-6 text-xl text-center w-full">@${escapeHtml(config.twitterUsername)}</p>
        </a>

        <div class="bg-muted relative overflow-hidden rounded-lg col-span-1 row-span-2">
          <img
            src="https://i.postimg.cc/NGK80VQ1/cf954b8923fbafc5cfc0c66344b6a6f9.jpg"
            alt=""
            class="absolute saturate-150 w-full h-full object-cover inset-0"
          />
          <div class="absolute inset-0 bg-gradient-to-b to-black/80 from-transparent"></div>
          <p class="z-20 absolute bottom-6 text-center w-full">
            <a
              href="https://github.com/${encodeURIComponent(config.githubUsername)}"
              class="text-white font-semibold hover:underline p-2 px-4 bg-pink-600 opacity-80 rounded-md backdrop-blur"
            >@${escapeHtml(config.githubUsername)}</a>
          </p>
        </div>

        <a
          href="${escapeUrl(config.linkedinUsername ? `https://www.linkedin.com/in/${encodeURIComponent(config.linkedinUsername)}` : "#")}"
          class="bg-gradient-to-tl from-black to-blue-600 p-4 relative rounded-lg overflow-hidden col-span-1 columns-3 row-span-1 min-h-[150px]"
        >
          <i
            data-lucide="linkedin"
            class="absolute glow -bottom-1 -right-2 w-20 h-20 text-[#56d2ff]"
            strokeWidth="1"
          ></i>
          <p class="text-center text-lg w-full">@${escapeHtml(config.linkedinUsername)}</p>
        </a>

        <div class="bg-muted overflow-hidden border border-red-600/40 rounded-lg col-span-2 row-span-1">
          <img
            src="https://github-readme-activity-graph.vercel.app/graph?username=${encodeURIComponent(config.githubUsername)}&bg_color=030312&color=ff8080&line=e00a60&point=ff7171&area=true&hide_border=true"
            alt="graph"
            class="w-full object-cover h-[150px]"
          />
        </div>

        <div class="p-4 bg-gradient-to-br from-gray-100 via-gray-300 to-gray-600/80 rounded-lg col-span-1 row-span-1 flex relative flex-col items-center justify-center min-h-32 overflow-hidden">
          <h1 class="font-semibold text-xl bg-gradient-to-b from-[#797979] to-[#040e1f] bg-clip-text absolute top-6 break-all left-4 text-transparent leading-[100%] tracking-tighter">
            ${escapeHtml(portfolioDisplay)}
          </h1>
          <img
            src="https://i.postimg.cc/cJnD7cGL/earth.png"
            width="200"
            height="200"
            alt=""
            class="absolute -bottom-24 -right-24"
          />
        </div>

        <div class="grid gap-4 grid-cols-4 col-span-4 row-span-2">
          <div class="col-span-2 row-span-2">
            <div
              class="grid grid-cols-4 grid-rows-3 gap-4 auto-rows-fr rounded-xl overflow-hidden w-full h-full"
            >
              <div
                class="bg-gradient-to-br from-amber-500/40 via-amber-500/10 to-transparent rounded-xl p-4 flex flex-col justify-between col-span-2 relative row-span-2"
              >
                <div
                  class="flex absolute top-2 px-3 left-0 items-center justify-between w-full opacity-70"
                >
                  <i data-lucide="star" class="w-10 h-10 text-yellow-400 fill-current"></i>
                  <i data-lucide="star" class="w-10 h-10 text-yellow-400 fill-current"></i>
                  <i data-lucide="star" class="w-10 h-10 text-yellow-400 fill-current"></i>
                  <i data-lucide="star" class="w-10 h-10 text-yellow-400 fill-current"></i>
                  <i data-lucide="star" class="w-10 h-10 text-yellow-400 fill-current"></i>
                </div>
                <h3 class="text-2xl mt-16 text-end text-muted-foreground font-medium">
                  Total Stars
                </h3>
                <div class="text-end text-yellow-400 text-7xl font-bold">
                  ${userStats["Star Earned"]}
                </div>
              </div>

              <div class="bg-gradient-to-b from-pink-900/20 to-neutral-900/50 rounded-xl relative p-4 flex flex-col justify-between col-span-1 row-span-1">
                <i data-lucide="git-pull-request" class="text-pink-400 absolute top-2 w-5 h-5"></i>
                <span class="text-gray-300 text-sm pt-4 font-medium">PRs</span>
                <div class="text-pink-400 text-3xl font-bold mt-2">${userStats["Pull Requests"]}</div>
              </div>

              <div class="bg-gradient-to-tl from-rose-950/20 to-stone-900/50 relative rounded-xl p-4 flex flex-col justify-between col-span-1 row-span-1">
                <i data-lucide="users" class="text-red-500 absolute top-2 w-5 h-5"></i>
                <span class="text-gray-300 text-sm pt-4 font-medium">Followers</span>
                <div class="text-red-500 text-4xl font-bold mt-2">${userStats.Followers}</div>
              </div>

              <div class="bg-gradient-to-t from-black to-slate-800/50 overflow-hidden relative rounded-xl p-4 flex flex-col justify-between col-span-2 row-span-2">
                <svg class="absolute inset-0 object-cover rotate-180" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 800 800"><defs><linearGradient x1="50%" y1="0%" x2="50%" y2="100%" id="oooscillate-grad"><stop stop-color="hsl(105, 69%, 40%)" stop-opacity="1" offset="0%"></stop><stop stop-color="hsl(105, 69%, 60%)" stop-opacity="1" offset="100%"></stop></linearGradient></defs><g stroke-width="2" stroke="url(#oooscillate-grad)" fill="none" stroke-linecap="round"><path d="M 0 500 Q 200 35 400 400 Q 600 765 800 500" opacity="1.00"></path><path d="M 0 475 Q 200 35 400 400 Q 600 765 800 475" opacity="0.95"></path><path d="M 0 450 Q 200 35 400 400 Q 600 765 800 450" opacity="0.90"></path><path d="M 0 425 Q 200 35 400 400 Q 600 765 800 425" opacity="0.85"></path><path d="M 0 400 Q 200 35 400 400 Q 600 765 800 400" opacity="0.80"></path><path d="M 0 375 Q 200 35 400 400 Q 600 765 800 375" opacity="0.75"></path><path d="M 0 350 Q 200 35 400 400 Q 600 765 800 350" opacity="0.70"></path><path d="M 0 325 Q 200 35 400 400 Q 600 765 800 325" opacity="0.65"></path><path d="M 0 300 Q 200 35 400 400 Q 600 765 800 300" opacity="0.60"></path><path d="M 0 275 Q 200 35 400 400 Q 600 765 800 275" opacity="0.55"></path><path d="M 0 250 Q 200 35 400 400 Q 600 765 800 250" opacity="0.50"></path><path d="M 0 225 Q 200 35 400 400 Q 600 765 800 225" opacity="0.45"></path><path d="M 0 200 Q 200 35 400 400 Q 600 765 800 200" opacity="0.40"></path><path d="M 0 175 Q 200 35 400 400 Q 600 765 800 175" opacity="0.35"></path><path d="M 0 150 Q 200 35 400 400 Q 600 765 800 150" opacity="0.30"></path><path d="M 0 125 Q 200 35 400 400 Q 600 765 800 125" opacity="0.25"></path><path d="M 0 100 Q 200 35 400 400 Q 600 765 800 100" opacity="0.20"></path><path d="M 0 75 Q 200 35 400 400 Q 600 765 800 75" opacity="0.15"></path><path d="M 0 50 Q 200 35 400 400 Q 600 765 800 50" opacity="0.10"></path></g></svg>
                <div class="flex items-center w-full">
                  <i data-lucide="activity" class="text-green-400 w-11 h-11"></i>
                  <span class="text-muted-foreground w-full text-end text-2xl font-medium">Commits</span>
                </div>
                <div class="text-green-400 text-6xl text-end font-bold">
                  ${userStats.Commits}
                </div>
              </div>

              <div class="bg-muted/30 relative overflow-hidden rounded-xl p-4 flex flex-col justify-between col-span-2 row-span-1">
                <svg class="absolute -z-10 inset-0 object-cover brightness-150" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 800 800"><g shape-rendering="crispEdges" stroke-linejoin="round" fill="none" stroke-width="1" stroke="hsl(220, 64%, 12%)"><polygon points="800,0 600,200 800,200"></polygon><polygon points="600,0 400,0 600,200"></polygon><polygon points="600,300 600,200 500,200"></polygon><polygon points="400,300 500,200 500,300"></polygon><polygon points="400,300 500,300 500,400"></polygon><polygon points="600,400 500,400 500,300"></polygon><polygon points="800,200 800,400 600,200"></polygon><polygon points="400,0 200,0 200,200"></polygon><polygon points="0,0 200,0 200,200"></polygon><polygon points="0,200 200,400 0,400"></polygon><polygon points="300,200 400,200 300,300"></polygon><polygon points="200,300 200,200 300,200"></polygon><polygon points="300,400 200,400 300,300"></polygon><polygon points="300,300 400,400 300,400"></polygon><polygon points="300,500 300,400 400,500"></polygon><polygon points="200,500 300,500 300,400"></polygon><polygon points="300,600 200,600 200,500"></polygon><polygon points="400,500 400,600 300,500"></polygon><polygon points="200,500 200,400 100,500"></polygon><polygon points="100,400 100,500 0,400"></polygon><polygon points="0,500 100,500 0,600"></polygon><polygon points="200,600 200,500 100,600"></polygon><polygon points="0,800 200,800 200,600"></polygon><polygon points="400,800 200,800 200,600"></polygon><polygon points="800,400 600,600 800,600"></polygon><polygon points="600,500 600,400 500,500"></polygon><polygon points="500,500 400,500 400,400"></polygon><polygon points="500,600 400,500 400,600"></polygon><polygon points="500,600 600,600 500,500"></polygon><polygon points="600,700 500,700 600,600"></polygon><polygon points="500,600 500,700 400,600"></polygon><polygon points="500,800 500,700 400,800"></polygon><polygon points="600,700 600,800 500,800"></polygon><polygon points="800,600 800,800 600,800"></polygon></g></svg>
                <i data-lucide="git-branch" class="text-blue-400 absolute left-12 bottom-4 w-10 h-10"></i>
                <span class="text-muted-foreground text-center w-full text-sm font-medium">Contributed To</span>
                <div class="text-blue-400 text-4xl text-center font-bold mt-2">
                  ${userStats["Contributed To"]}
                </div>
              </div>
            </div>
          </div>

          <div class="w-full h-full col-span-2 row-span-2">
            <div class="max-w-xl w-full h-full rounded-xl">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full h-full">
                <div class="flex w-full h-full flex-col space-y-4">
                  <div class="bg-gradient-to-tr from-slate-900 to-secondary/20 rounded-lg p-4 h-full flex flex-col items-center justify-center">
                    <i data-lucide="calendar" class="w-8 h-8 mb-2 text-blue-400"></i>
                    <h3 class="text-sm font-medium text-gray-400">Total Contributions</h3>
                    <p class="text-3xl font-bold text-blue-400">${contributionStats.totalContributions}</p>
                    <p class="text-xs text-gray-500 mt-2">
                      ${escapeHtml(contributionStats.firstDateofContribution || "No contributions yet")} - Present
                    </p>
                  </div>
                  <div class="rounded-lg bg-gradient-to-b from-yellow-500/15 via-transparent to-yellow-500/10 p-4 h-full flex flex-col items-center justify-center">
                    <i data-lucide="trophy" class="w-8 h-8 mb-2 text-yellow-400"></i>
                    <h3 class="text-sm font-medium text-gray-400">Longest Streak</h3>
                    <p class="text-3xl font-bold text-yellow-400">${contributionStats.longestStreak}</p>
                    <p class="text-xs text-gray-500 mt-2">
                      ${escapeHtml(
                        contributionStats.longestStreakStartDate && contributionStats.longestStreakEndDate
                          ? `${contributionStats.longestStreakStartDate} - ${contributionStats.longestStreakEndDate}`
                          : "No streak yet",
                      )}
                    </p>
                  </div>
                </div>
                <div class="bg-gradient-to-r to-orange-800/10 from-orange-800/10 via-muted/10 rounded-lg p-6 flex flex-col items-center justify-center relative">
                  <i data-lucide="flame" class="w-28 h-28 mb-4 text-orange-600 rounded-full p-4"></i>
                  <h3 class="text-lg font-medium text-gray-400">Current Streak</h3>
                  <p class="text-6xl font-bold text-orange-600 my-4">${contributionStats.currentStreak}</p>
                  <p class="text-sm text-gray-500">
                    ${escapeHtml(contributionStats.currentStreakStartDate || "No active streak")} - Present
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-gradient-to-br from-green-950/80 p-4 col-span-4 row-span-2 rounded-lg w-full h-full">
          <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold">${escapeHtml(config.githubUsername)}'s Contribution Graph</h1>
            <div class="flex items-center justify-end text-sm">
              <span>Less</span>
              <div class="flex gap-2 mx-3">
                <div class="w-4 h-4 rounded-sm" title="Contribution level 0" style="background-color: rgb(25, 25, 25);"></div>
                <div class="w-4 h-4 rounded-sm" title="Contribution level 1" style="background-color: rgb(20, 83, 45);"></div>
                <div class="w-4 h-4 rounded-sm" title="Contribution level 2" style="background-color: rgb(30, 122, 30);"></div>
                <div class="w-4 h-4 rounded-sm" title="Contribution level 3" style="background-color: rgb(40, 167, 69);"></div>
                <div class="w-4 h-4 rounded-sm" title="Contribution level 4" style="background-color: rgb(0, 239, 87);"></div>
              </div>
              <span>More</span>
            </div>
          </div>
          <div class="flex justify-center pb-4 items-center w-full h-full">
            ${graphSvg}
          </div>
        </div>
      </div>
    </div>
    <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
    <script>
      lucide.createIcons();
    </script>
  </body>
</html>`;
}

async function generateBento(config: BentoConfig) {
  const currentYear = new Date().getFullYear();
  const [contributionDays, userStats, contributionStats] = await Promise.all([
    fetchYearContributions(config.githubUsername, currentYear),
    fetchUserStats(config.githubUsername),
    fetchContributionStats(config.githubUsername),
  ]);
  const graphSvg = generateContributionGraph(contributionDays);
  const html = renderHtml(config, userStats, contributionStats, graphSvg);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 1100,
      height: 1160,
      deviceScaleFactor: 1.4,
    });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await page.screenshot({
      path: outputPath,
      type: "png",
    });
  } finally {
    await browser.close();
  }
}

await generateBento(config);
console.log(`Updated ${outputPath}`);
