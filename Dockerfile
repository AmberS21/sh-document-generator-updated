FROM nginx:1.27-alpine

# Replace default Nginx site config with static-site settings for App Service.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy only files required by the app.
COPY index.html /usr/share/nginx/html/
COPY templates/ /usr/share/nginx/html/templates/
COPY ["Updated Logo.png", "/usr/share/nginx/html/Updated Logo.png"]
COPY ["SH_Global_Candidate_Profile_No Scorecard.docx", "/usr/share/nginx/html/SH_Global_Candidate_Profile_No Scorecard.docx"]
COPY ["SH_Global_Candidate_Profile_With_Scorecard.docx", "/usr/share/nginx/html/SH_Global_Candidate_Profile_With_Scorecard.docx"]
COPY ["Service Team - Project Report (with Notes).xlsx", "/usr/share/nginx/html/Service Team - Project Report (with Notes).xlsx"]

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]