const apiUrl = "https://opbento.vercel.app/api/bento?n=Nihaal%20SP&g=nerdylua&x=nerdylua&l=nihaal-sp&i=https%3A%2F%2Favatars.githubusercontent.com%2Fu%2F150607136%3Fv%3D4&p=&z=d1529";
interface BentoResponse {
  url: string;
}

const fetchBentoUrl = async (apiUrl: string): Promise<string> => {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: BentoResponse = (await response.json()) as BentoResponse;
    return data.url;
  } catch (error) {
    console.error("Error fetching Bento URL:", error);
    throw error;
  }
};

// @ts-ignore
fetchBentoUrl(apiUrl);
