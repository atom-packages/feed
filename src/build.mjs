import { minify as htmlMinify } from 'html-minifier-terser';
import { createTokenAuth }from '@octokit/auth-token';
import { Feed } from 'feed';
import { Octokit }from '@octokit/core';
import { promises as fs } from 'fs';
import { render } from 'ejs';
import { resolve } from 'path';
import gh from 'parse-github-url';
import MFH from 'make-fetch-happen';

const fetch = MFH.defaults({
    cacheManager: '.cache'
});

const htmlMinifyOptions = {
    collapseWhitespace: true,
    removeAttributeQuotes: true,
    removeComments: true
};

const baseUrl = 'https://atom-packages.github.io/feed';

(async () => {
    const auth = createTokenAuth(process.env.GITHUB_TOKEN);
    const { token } = await auth();

    const octokit = new Octokit({
        auth: token
    });

    try {
        await fs.mkdir('public', {
            recursive: true
        });
        console.log('Output folder created');
    } catch(err) {
        console.log('Output folder already exists');
    }

    const feedTypes = [
        {
            name: 'Newest Packages',
            slug: 'releases',
            sort: 'created_at'
        },
        {
            name: 'Updated Packages',
            slug: 'updates',
            sort: 'updated_at',
        },
    ];

    await Promise.all(feedTypes.map(async feedType => {
        console.log(`Downloading https://api.pulsar-edit.dev/api/packages?page=1&sort=${feedType.sort}&direction=desc`);

        const response = await fetch(`https://api.pulsar-edit.dev/api/packages?page=1&sort=${feedType.sort}&direction=desc`);
        const packages = await response.json();

        if (!packages?.length) {
            throw Error('Could not retrieve packages');
        }

        const feed = new Feed({
            title: `Atom Packages: ${feedType.name}`,
            id: `${baseUrl}`,
            link: `${baseUrl}`,
            language: "en",
            favicon: `${baseUrl}/favicon.svg`,
            updated: new Date(),
            generator: "@atom-packages/feed",
            feedLinks: {
                rss: `${baseUrl}/${feedType.slug}.rss`,
                json: `${baseUrl}/${feedType.slug}.json`,
                atom: `${baseUrl}/${feedType.slug}.atom`
            }
        });

        (await Promise.all(packages
            .map(async item => {
                let repositoryURL;

                switch (true) {
                    case Boolean(item?.repository?.url?.length):
                        repositoryURL = item.repository.url
                        break;

                    case Boolean(item?.repository?.length):
                        repositoryURL = item.repository
                        break;

                    case Boolean(item?.metadata?.repository?.url?.length):
                        repositoryURL = item.metadata.repository.url
                        break;

                    case Boolean(item?.metadata?.repository?.length):
                        repositoryURL = item.metadata.repository
                        break;

                    default:
                        console.log('Missing repository:', item.repository);
                        return;
                }
                
                const { repo, owner } = gh(repositoryURL);
                let response;


                try {
                    response = await octokit.request(`GET /repos/${repo}/releases`, {
                        per_page: 1
                    });
                } catch (err) {
                    return;
                }

                if (!response?.data[0]?.published_at) {
                    return;
                }

                const publishDate = new Date(response.data[0]?.published_at);
                
                return {
                    id: `https://atom.io/packages/${item.name}`,
                    title: item.name,
                    description: item.metadata?.description ?? item.description,
                    content: item.metadata?.readme ?? item.readme,
                    author: {
                        name: owner
                    },
                    link: `https://atom.io/packages/${item.name}`,
                    date: publishDate
                };
            })
        ))
        .filter(item => item)
        .sort((a, b) => new Date(b['date']).getTime() - new Date(a['date']).getTime())
        .map(item => feed.addItem(item));

        await fs.writeFile(`public/${feedType.slug}.rss`, feed.rss2(feed));
        await fs.writeFile(`public/${feedType.slug}.json`, feed.json1(feed));
        await fs.writeFile(`public/${feedType.slug}.atom`, feed.atom1(feed));
    })); 
    
    const html = await fs.readFile(resolve('./src/template.ejs'), { encoding: 'utf8' });
    const htmlMinified = await htmlMinify(render(html, {
        lastUpdated: new Date().toLocaleString('en-GB', { timeZone: 'UTC' })
    }), htmlMinifyOptions);
    
    const favicon = await fs.readFile(resolve('./src/favicon.svg'), { encoding: 'utf8' });
    const faviconMinified = await htmlMinify(favicon, {
        ...htmlMinifyOptions,
        removeAttributeQuotes: false
    })

    await fs.writeFile('public/favicon.svg', faviconMinified);
    await fs.writeFile('public/index.html', htmlMinified);    
})();
